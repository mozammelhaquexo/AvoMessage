/**
 * components/posts/RichText.tsx — renders post/comment bodies with clickable
 * hashtags (#tag → /hashtag/tag) and mentions (@user → /profile/user).
 * URLs become external links. XSS-safe: text is never injected as HTML —
 * the body is tokenized and rendered as React nodes.
 */
"use client";

import Link from "next/link";
import { memo, type ReactNode } from "react";

const TOKEN_RE = /(https?:\/\/[^\s<>"']+|#[\p{L}\p{N}_]{1,64}|@[a-zA-Z0-9_]{3,24})/gu;

function renderTokens(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    if (start > last) out.push(text.slice(last, start));
    if (token.startsWith("#")) {
      const tag = token.slice(1);
      out.push(
        <Link
          key={key++}
          href={`/hashtag/${encodeURIComponent(tag)}`}
          className="font-medium text-brand-strong hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {token}
        </Link>,
      );
    } else if (token.startsWith("@")) {
      const username = token.slice(1);
      out.push(
        <Link
          key={key++}
          href={`/profile/${username}`}
          className="font-medium text-brand-strong hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {token}
        </Link>,
      );
    } else {
      out.push(
        <a
          key={key++}
          href={token}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-info-strong underline decoration-info/40 underline-offset-2 hover:decoration-info"
          onClick={(e) => e.stopPropagation()}
        >
          {token}
        </a>,
      );
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const RichText = memo(function RichText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <span className={className}>{renderTokens(text)}</span>;
});
