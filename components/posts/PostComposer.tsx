/**
 * components/posts/PostComposer.tsx — post composer entry point.
 *
 * Two modes:
 * - `global`: modal dialog driven by the composer-context (AppShell renders
 *   one of these; sidebar / mobile nav "Create" buttons open it).
 * - inline (default): card composer for feeds (e.g. home feed top, company
 *   feed tab). Props: `companyId` (forces COMPANY visibility),
 *   `onPosted(post)`, `placeholder`.
 *
 * This file is now only the wrapper: the form itself — character counter, drag
 * & drop + file-picker uploads, media previews, visibility selector, emoji
 * picker, @mention autocomplete and optimistic posting — lives in
 * `./ComposerForm`. It was split out during code review with no behaviour
 * change, and the imports this file no longer needs were removed with it.
 */
"use client";

import { useState } from "react";
import { Card, Dialog } from "@/components/ui";
import type { Post } from "@/lib/api-types";
import { useComposer } from "@/components/layout/composer-context";
import { ComposerForm } from "./ComposerForm";

export interface PostComposerProps {
  /** Render as the global modal (AppShell). Mutually exclusive with inline. */
  global?: boolean;
  /** Inline card props (Engineer B company-feed call sites). */
  companyId?: string;
  onPosted?: (post: Post) => void;
  onCreated?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function PostComposer({
  global = false,
  companyId,
  onPosted,
  onCreated,
  placeholder,
  autoFocus = false,
}: PostComposerProps) {
  if (global) return <GlobalComposer onCreated={onCreated} />;
  return (
    <InlineComposer
      companyId={companyId}
      onPosted={onPosted}
      onCreated={onCreated}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
  );
}

/* ── Global modal wrapper ─────────────────────────────────────────────── */

function GlobalComposer({ onCreated }: { onCreated?: () => void }) {
  const { composerOpen, closeComposer } = useComposer();
  const [key, setKey] = useState(0);

  return (
    <Dialog
      open={composerOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeComposer();
          setKey((k) => k + 1); // reset form state on close
        }
      }}
      title="Create post"
      size="lg"
      contentClassName="p-0"
    >
      <div className="p-4 sm:p-5">
        <ComposerForm
          key={key}
          onPosted={() => {
            closeComposer();
            setKey((k) => k + 1);
            onCreated?.();
          }}
          autoFocus
        />
      </div>
    </Dialog>
  );
}

/* ── Inline card wrapper ──────────────────────────────────────────────── */

function InlineComposer({
  companyId,
  onPosted,
  onCreated,
  placeholder,
  autoFocus,
}: Omit<PostComposerProps, "global">) {
  const [key, setKey] = useState(0);
  return (
    <Card>
      <div className="p-4">
        <ComposerForm
          key={key}
          companyId={companyId}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onPosted={(post) => {
            setKey((k) => k + 1);
            onPosted?.(post);
            onCreated?.();
          }}
        />
      </div>
    </Card>
  );
}
