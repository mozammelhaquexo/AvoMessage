/**
 * components/chat/ChatComposer.tsx — message composer.
 *
 * Hand-rolled emoji picker (no dependency), file attachments (uploaded via
 * POST /api/uploads kind=message), reply preview, Enter-to-send.
 *
 * Voice messages integrate the voice engineer's `components/voice/*`:
 * `VoiceRecorder` (record → preview → upload) and `AudioPlayer` (in
 * MessageBubble). The recorder uploads via POST /api/uploads kind=voice and
 * calls back with the upload; the composer then sends messageType VOICE.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, Icon, Textarea, toast } from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiUpload } from "@/lib/api-client";
import { VoiceRecorder } from "@/components/voice";
import { springSnappy } from "@/lib/motion";
import type { UploadedVoice } from "@/lib/voice/upload";
import type { AttachmentKind, ChatMessage, MessageType } from "@/lib/types";

const EMOJI_GRID = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😎", "🤔",
  "😮", "😢", "😭", "😡", "👍", "👎", "🙏", "👏",
  "🔥", "🎉", "❤️", "💯", "🥑", "✅", "❌", "👀",
  "🤝", "💡", "🚀", "☕", "🌙", "⭐", "🎵", "📎",
];

export interface ComposerAttachment {
  kind: AttachmentKind;
  url: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface ComposerInput {
  body?: string;
  type?: MessageType;
  replyToId?: string;
  attachments?: ComposerAttachment[];
}

interface ChatComposerProps {
  onSend: (input: ComposerInput) => void;
  disabled?: boolean;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.zip";

function kindForMime(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "VOICE";
  return "FILE";
}

export function ChatComposer({
  onSend,
  disabled,
  replyTo,
  onCancelReply,
  onTypingStart,
  onTypingStop,
}: ChatComposerProps) {
  const [body, setBody] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!emojiOpen) return;
    const close = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmojiOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);

  function insertEmoji(emoji: string) {
    const el = textRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + emoji + body.slice(end);
    setBody(next);
    onTypingStart();
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function uploadFile(file: File, kind: "message" | "voice"): Promise<ComposerAttachment | null> {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    try {
      const res = await apiUpload<{ id: string; url: string; mimeType: string; sizeBytes: number; width?: number; height?: number }>(
        "/api/uploads",
        form,
      );
      return {
        kind: kindForMime(res.mimeType),
        url: res.url,
        name: file.name,
        mimeType: res.mimeType,
        sizeBytes: res.sizeBytes,
        width: res.width,
        height: res.height,
      };
    } catch (e) {
      toast({ variant: "error", title: e instanceof Error ? e.message : `Upload failed (${file.name})` });
      return null;
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const picked = Array.from(files).slice(0, 10 - attachments.length);
    const done: ComposerAttachment[] = [];
    for (const f of picked) {
      const a = await uploadFile(f, "message");
      if (a) done.push(a);
    }
    setAttachments((prev) => [...prev, ...done]);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Voice note recorded + uploaded by components/voice/VoiceRecorder. */
  function handleVoiceSent(upload: UploadedVoice, _durationMs: number) {
    onSend({
      body: body.trim() || undefined,
      type: "VOICE",
      replyToId: replyTo?.id,
      attachments: [
        {
          kind: "VOICE",
          url: upload.url,
          name: "Voice message",
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
        },
      ],
    });
    setBody("");
    setVoiceOpen(false);
    onCancelReply();
    onTypingStop();
  }

  function send() {
    const text = body.trim();
    if ((!text && attachments.length === 0) || disabled || uploading) return;
    const type: MessageType = attachments.some((a) => a.kind === "VIDEO")
      ? "VIDEO"
      : attachments.some((a) => a.kind === "IMAGE")
        ? "IMAGE"
        : attachments.length > 0
          ? "FILE"
          : "TEXT";
    onSend({ body: text || undefined, type, replyToId: replyTo?.id, attachments: attachments.length ? attachments : undefined });
    setBody("");
    setAttachments([]);
    onCancelReply();
    onTypingStop();
  }

  const canSend = (body.trim().length > 0 || attachments.length > 0) && !disabled && !uploading;

  return (
    <div className="border-t border-line bg-surface px-3 pb-3 pt-2 sm:px-4">
      {/* Reply preview */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-brand bg-surface-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-caption font-semibold text-brand-strong">
                  Replying to {replyTo.sender?.name ?? "message"}
                </p>
                <p className="line-clamp-1 text-caption text-ink-2">{replyTo.body ?? "Attachment"}</p>
              </div>
              <button
                type="button"
                onClick={onCancelReply}
                aria-label="Cancel reply"
                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink"
              >
                <Icon name="x" size={14} aria-hidden />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {attachments.map((a) => (
            <div key={a.url} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1.5">
              <Icon name={a.kind === "IMAGE" ? "image" : a.kind === "VIDEO" ? "video" : "paperclip"} size={16} aria-hidden className="text-ink-3" />
              <span className="max-w-32 truncate text-caption text-ink-2">{a.name}</span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))}
                aria-label={`Remove ${a.name}`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink"
              >
                <Icon name="x" size={12} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Voice recorder panel (components/voice) */}
      <AnimatePresence>
        {voiceOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-2">
              <VoiceRecorder
                onSend={handleVoiceSent}
                onCancel={() => setVoiceOpen(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          aria-label="Attach files"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
          aria-label="Attach a file"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          {uploading ? <Icon name="refresh" size={20} aria-hidden className="animate-spin" /> : <Icon name="paperclip" size={20} aria-hidden />}
        </button>

        <div ref={emojiRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            disabled={disabled}
            aria-label="Insert emoji"
            aria-expanded={emojiOpen}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-surface-2",
              emojiOpen ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            <Icon name="smile" size={20} aria-hidden />
          </button>
          {emojiOpen && (
            <div
              role="dialog"
              aria-label="Emoji picker"
              className="absolute bottom-12 left-0 z-dropdown grid w-64 max-w-[calc(100vw-2rem)] grid-cols-6 gap-0.5 rounded-lg border border-line bg-surface p-2 shadow-lg"
            >
              {EMOJI_GRID.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  aria-label={`Insert ${emoji}`}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-xl transition-transform hover:scale-125 hover:bg-surface-2"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <Textarea
          ref={textRef}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            onTypingStart();
          }}
          onBlur={onTypingStop}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message…"
          aria-label="Message"
          rows={1}
          maxLength={4000}
          disabled={disabled}
          className="max-h-32 min-h-10 resize-none"
        />

        <VoiceRecorderButton
          open={voiceOpen}
          onToggle={() => setVoiceOpen((v) => !v)}
          disabled={disabled || uploading}
        />

        <motion.span
          animate={{ scale: canSend ? 1 : 0.9, opacity: canSend ? 1 : 0.45 }}
          transition={springSnappy}
          className="shrink-0"
        >
          <Button
            size="icon"
            onClick={send}
            disabled={!canSend}
            loading={uploading}
            aria-label="Send message"
          >
            <Icon name="send" size={18} aria-hidden />
          </Button>
        </motion.span>
      </div>
    </div>
  );
}

/** Mic toggle — opens the voice engineer's VoiceRecorder panel above. */
function VoiceRecorderButton({
  open,
  onToggle,
  disabled,
}: {
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={open ? "Close voice recorder" : "Record a voice message"}
      aria-expanded={open}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-2",
        open ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink",
        "disabled:opacity-50",
      )}
    >
      <Icon name="mic" size={20} aria-hidden />
    </button>
  );
}
