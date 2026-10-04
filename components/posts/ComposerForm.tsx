/**
 * components/posts/ComposerForm.tsx — the shared post composer form.
 *
 * Extracted from PostComposer.tsx (code-review split; no behavior change).
 * Used by the global modal and the inline feed composer.
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  Avatar,
  Button,
  Icon,
  Select,
  Spinner,
  Textarea,
  toast,
  Tooltip,
} from "@/components/ui";
import { cn } from "@/components/ui/utils";
import { apiGet, apiPost, ApiError, uploadFile } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { useDebouncedValue } from "@/lib/hooks";
import type { CompanySummary, Post, PostVisibility, SearchUser, UploadedFile } from "@/lib/api-types";

const MAX_CHARS = 2000;
const MAX_MEDIA = 4;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm";

/** Small hand-rolled emoji palette (content, not UI chrome). */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: "Smileys", emojis: ["😀", "😄", "😉", "😍", "🤔", "😅", "🥳", "😎", "🤗", "🙂", "😴", "🤯"] },
  { label: "Gestures", emojis: ["👍", "👏", "🙌", "🤝", "💪", "👋", "✌️", "🤞", "👀", "💯"] },
  { label: "Hearts", emojis: ["❤️", "💚", "💙", "💜", "🧡", "🤍", "💔", "✨", "🔥", "⭐"] },
  { label: "Objects", emojis: ["🎉", "🎧", "📸", "💡", "🚀", "☕", "🌱", "🥑", "🏢", "📅"] },
];

interface PendingMedia {
  id: string; // local id
  file: File;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  uploaded?: UploadedFile;
  error?: string;
}

export interface ComposerFormProps {
  companyId?: string;
  onPosted?: (post: Post) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function ComposerForm({
  companyId: forcedCompanyId,
  onPosted,
  placeholder,
  autoFocus,
}: ComposerFormProps) {
  const { user } = useSession();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("PUBLIC");
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [companyId, setCompanyId] = useState<string>(forcedCompanyId ?? "");
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [posting, setPosting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<SearchUser[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  const debouncedMention = useDebouncedValue(mentionQuery, 250);

  // Companies for the COMPANY visibility option.
  useEffect(() => {
    let cancelled = false;
    apiGet<CompanySummary[] | { data: CompanySummary[] }>("/api/companies")
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : res.data;
        setCompanies(list);
        if (list.length === 1 && !forcedCompanyId) setCompanyId(list[0]!.id);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [forcedCompanyId]);

  // Mention autocomplete.
  useEffect(() => {
    if (debouncedMention === null || debouncedMention.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale suggestions on query change
      setMentionResults([]);
      return;
    }
    let cancelled = false;
    apiGet<{ data: SearchUser[] }>("/api/search", { params: { q: debouncedMention, type: "users", limit: 5 } })
      .then((res) => {
        if (!cancelled) {
          setMentionResults(res.data);
          setMentionIndex(0);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [debouncedMention]);

  // Close emoji picker on outside click or Escape.
  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (e: PointerEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setEmojiOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);

  // Revoke preview URLs on unmount.
  useEffect(() => {
    const current = media;
    return () => {
      for (const m of current) URL.revokeObjectURL(m.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insertAtCursor = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((b) => b + text);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + text.length;
    });
  }, [body]);

  // ── Media ────────────────────────────────────────────────────────────
  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    setMedia((prev) => {
      const room = MAX_MEDIA - prev.length;
      const accepted = list.slice(0, Math.max(0, room));
      if (list.length > room) {
        toast({ variant: "warning", title: `Maximum ${MAX_MEDIA} files per post` });
      }
      return [
        ...prev,
        ...accepted.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          status: "uploading" as const,
        })),
      ];
    });
  }, []);

  // Upload each pending file exactly once (guard against effect re-runs).
  const uploadStartedRef = useRef(new Set<string>());
  useEffect(() => {
    for (const m of media) {
      if (m.status !== "uploading" || uploadStartedRef.current.has(m.id)) continue;
      uploadStartedRef.current.add(m.id);
      const id = m.id;
      uploadFile("post", m.file)
        .then((uploaded) => {
          setMedia((prev) => prev.map((p) => (p.id === id ? { ...p, status: "ready" as const, uploaded } : p)));
        })
        .catch((e) => {
          setMedia((prev) =>
            prev.map((p) =>
              p.id === id
                ? { ...p, status: "error" as const, error: e instanceof Error ? e.message : "Upload failed" }
                : p,
            ),
          );
        });
    }
  }, [media]);

  const removeMedia = (id: string) => {
    setMedia((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  // ── Textarea change: detect @mentions ────────────────────────────────
  const onBodyChange = (value: string, caret: number) => {
    setBody(value);
    const before = value.slice(0, caret);
    const match = /(?:^|\s)@([a-zA-Z0-9_]{1,24})$/.exec(before);
    setMentionQuery(match ? match[1] : null);
  };

  const applyMention = (username: string) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret);
    const match = /(?:^|\s)@([a-zA-Z0-9_]{1,24})$/.exec(before);
    if (!match) return;
    const at = before.lastIndexOf(`@${match[1]}`);
    const next = body.slice(0, at) + `@${username} ` + body.slice(caret);
    setBody(next);
    setMentionQuery(null);
    setMentionResults([]);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + username.length + 2;
      el?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionResults.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionResults.length) % mentionResults.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const picked = mentionResults[mentionIndex];
        if (picked) {
          e.preventDefault();
          applyMention(picked.username);
          return;
        }
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        setMentionResults([]);
        return;
      }
    }
  };

  // ── Submit ───────────────────────────────────────────────────────────
  const uploading = media.some((m) => m.status === "uploading");
  const failedMedia = media.some((m) => m.status === "error");
  const effectiveVisibility: PostVisibility = forcedCompanyId ? "COMPANY" : visibility;
  const effectiveCompanyId = forcedCompanyId ?? (effectiveVisibility === "COMPANY" ? companyId : undefined);
  const canPost =
    body.trim().length > 0 &&
    body.trim().length <= MAX_CHARS &&
    !uploading &&
    !failedMedia &&
    (effectiveVisibility !== "COMPANY" || !!effectiveCompanyId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canPost || posting) return;
    setPosting(true);
    try {
      const payload: Record<string, unknown> = {
        body: body.trim(),
        visibility: effectiveVisibility,
        mediaIds: media.filter((m) => m.status === "ready" && m.uploaded).map((m) => m.uploaded!.id),
      };
      if (effectiveCompanyId) payload.companyId = effectiveCompanyId;
      const post = forcedCompanyId
        ? await apiPost<Post>(`/api/companies/${forcedCompanyId}/posts`, { body: body.trim() })
        : await apiPost<Post>("/api/posts", payload);
      toast({ variant: "success", title: "Posted" });
      onPosted?.(post);
      window.dispatchEvent(new CustomEvent("avo:post-created", { detail: post }));
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "EMAIL_UNVERIFIED"
          ? "Verify your email before posting."
          : e instanceof Error
            ? e.message
            : "Couldn't publish your post. Please try again.";
      toast({ variant: "error", title: "Couldn't post", description: message });
    } finally {
      setPosting(false);
    }
  };

  const showCompanyOption = !forcedCompanyId && (companies?.length ?? 0) > 0;
  const visibilityOptions = [
    { value: "PUBLIC", label: "Public" },
    { value: "FOLLOWERS", label: "Followers" },
    ...(showCompanyOption ? [{ value: "COMPANY", label: "Company" }] : []),
  ];

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        "relative flex flex-col gap-3 rounded-xl",
        dragOver && "outline-2 outline-dashed outline-brand",
      )}
      aria-label="Compose post"
    >
      <div className="flex gap-3">
        <Avatar src={user?.avatarUrl} name={user?.name ?? "?"} size="md" className="shrink-0" />
        <div className="relative min-w-0 flex-1">
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              onBodyChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? "What's happening?"}
            rows={4}
            maxLength={MAX_CHARS}
            autoFocus={autoFocus}
            aria-label={placeholder ?? "Compose a post"}
            aria-describedby="composer-counter"
            className="w-full resize-y"
          />
          {/* Mention autocomplete */}
          {mentionQuery !== null && mentionResults.length > 0 && (
            <div
              role="listbox"
              aria-label="Mention suggestions"
              className="absolute left-0 right-0 top-full z-dropdown mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
            >
              {mentionResults.map((u, i) => (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(u.username);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                    i === mentionIndex ? "bg-surface-2" : "bg-transparent",
                  )}
                >
                  <Avatar src={u.avatarUrl} name={u.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-body-sm font-medium text-ink">{u.name}</span>
                    <span className="block truncate text-caption text-ink-3">@{u.username}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Media previews */}
      {media.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Attached media">
          {media.map((m) => (
            <div key={m.id} className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">
              {m.file.type.startsWith("video/") ? (
                <video src={m.previewUrl} className="h-full w-full object-cover" muted playsInline />
              ) : (
                <img decoding="async" loading="lazy" src={m.previewUrl} alt="Attachment preview" className="h-full w-full object-cover" />
              )}
              {m.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-overlay/60" aria-label="Uploading">
                  <Spinner size="sm" />
                </div>
              )}
              {m.status === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger/15 p-2 text-center">
                  <Icon name="alert" size={18} className="text-danger" />
                  <span className="text-tiny text-danger-strong">{m.error ?? "Upload failed"}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeMedia(m.id)}
                aria-label="Remove attachment"
                className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-overlay/70 text-on-overlay transition-colors hover:bg-overlay"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-1 border-t border-line pt-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          aria-label="Attach photos or video"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Tooltip content="Add photos or video">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Add photos or video"
            disabled={media.length >= MAX_MEDIA}
            className="flex h-11 w-11 items-center justify-center rounded-full text-brand-strong transition-colors hover:bg-brand-soft disabled:opacity-40"
          >
            <Icon name="image" size={20} />
          </button>
        </Tooltip>

        {/* Emoji picker */}
        <div ref={emojiRef} className="relative">
          <Tooltip content="Add emoji">
            <button
              type="button"
              onClick={() => setEmojiOpen((o) => !o)}
              aria-label="Add emoji"
              aria-expanded={emojiOpen}
              className="flex h-11 w-11 items-center justify-center rounded-full text-brand-strong transition-colors hover:bg-brand-soft"
            >
              <Icon name="smile" size={20} />
            </button>
          </Tooltip>
          {emojiOpen && (
            <div
              role="dialog"
              aria-label="Emoji picker"
              className="absolute bottom-full left-0 z-dropdown mb-2 max-h-64 w-72 overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-lg"
            >
              {EMOJI_GROUPS.map((group) => (
                <div key={group.label} className="mb-2">
                  <p className="mb-1 text-tiny font-semibold uppercase tracking-wide text-ink-3">{group.label}</p>
                  <div className="grid grid-cols-6 gap-0.5">
                    {group.emojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          insertAtCursor(emoji);
                          setEmojiOpen(false);
                        }}
                        aria-label={`Insert ${emoji} emoji`}
                        className="flex h-11 items-center justify-center rounded-lg text-xl transition-colors hover:bg-surface-2"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!forcedCompanyId && (
          <Select
            label="Post visibility"
            value={visibility}
            onValueChange={(v) => setVisibility(v as PostVisibility)}
            options={visibilityOptions}
            className="ml-1 max-w-44"
          />
        )}
        {forcedCompanyId && (
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-caption font-medium text-accent">
            <Icon name="building" size={14} aria-hidden /> Company post
          </span>
        )}
        {effectiveVisibility === "COMPANY" && !forcedCompanyId && (companies?.length ?? 0) > 1 && (
          <Select
            label="Company"
            value={companyId}
            onValueChange={setCompanyId}
            options={(companies ?? []).map((c) => ({ value: c.id, label: c.name }))}
            className="max-w-44"
          />
        )}

        <div className="ml-auto flex items-center gap-3">
          <span
            id="composer-counter"
            aria-live="polite"
            className={cn(
              "text-caption tabular-nums",
              body.length > MAX_CHARS ? "font-semibold text-danger" : body.length > MAX_CHARS - 100 ? "text-warning-strong" : "text-ink-3",
            )}
          >
            {MAX_CHARS - body.length}
          </span>
          <Button type="submit" loading={posting} disabled={!canPost}>
            Post
          </Button>
        </div>
      </div>
      {failedMedia && (
        <p role="alert" className="text-caption text-danger">
          One or more attachments failed to upload. Remove them or try again.
        </p>
      )}
    </form>
  );
}
