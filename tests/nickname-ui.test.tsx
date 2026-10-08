/**
 * Where a nickname actually shows up.
 *
 * The API tests (tests/api/nicknames.test.ts) prove the server RESOLVES a
 * `displayName`. They cannot prove that the thing a person looks at renders it.
 * That gap is exactly the shape of this bug class: the server returns the
 * nickname, the component keeps using `user.name`, every test passes, and the
 * user sets a nickname and never sees it.
 *
 * So this file asserts on rendered markup — the real components, statically
 * rendered with react-dom/server (no jsdom, no testing-library; see
 * tests/user-badges.test.tsx for the same approach).
 *
 * What is pinned:
 *   1. a group message byline uses the resolved name, and keeps the real name
 *      reachable as a tooltip (the link still goes to the real profile);
 *   2. with no resolver the bubble degrades to the real name — the live
 *      `message:new` path, which carries no member list;
 *   3. a quoted reply is renamed too;
 *   4. the member drawer shows the resolved name, and only shows the real name
 *      as a secondary label when they differ;
 *   5. the nickname editor offers "Remove" only when there is something to
 *      remove, and refuses to treat a blank box as a clear.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// `next/link` and the icon/overlay helpers reach for the router; a static
// render has none. Only the pieces the components actually touch are stubbed.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/messages/c1',
  useSearchParams: () => new URLSearchParams(),
}));

import { MessageBubble, type NameResolver } from '@/components/chat/MessageBubble';
import { NicknameEditor } from '@/components/chat/NicknameEditor';
import { ConversationMemberManager } from '@/components/chat/ConversationMemberManager';
import { memberDisplayName } from '@/lib/chat';
import type { ChatMessage, ConversationMemberView, PublicUser } from '@/lib/types';

const ADA: PublicUser = {
  id: 'u-ada',
  name: 'Ada Lovelace',
  username: 'ada',
  avatarUrl: null,
  bio: null,
  isVerified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const GRACE: PublicUser = {
  ...ADA,
  id: 'u-grace',
  name: 'Grace Hopper',
  username: 'grace',
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderId: ADA.id,
    body: 'Hello there',
    type: 'TEXT',
    createdAt: '2026-10-08T09:00:00.000Z',
    editedAt: null,
    sender: ADA,
    attachments: [],
    reactions: [],
    voice: null,
    replyTo: null,
    forwardedFrom: null,
    ...overrides,
  };
}

/**
 * The resolver `ChatWindow` builds, standing in for the open thread's members:
 * the same `memberDisplayName` call over the same server-resolved rows, so this
 * exercises the real helper rather than a stand-in.
 */
const bossResolver: NameResolver = (userId, fallback) =>
  memberDisplayName(
    [
      { user: { id: ADA.id, name: ADA.name }, displayName: 'Boss' },
      { user: { id: GRACE.id, name: GRACE.name }, displayName: 'Chief' },
    ],
    userId,
    fallback,
  );

/**
 * The text of the byline, pulled out of the profile link.
 *
 * Extracted rather than searched for as a bare substring, because the avatar
 * renders the SAME resolved name in its `aria-label`: `toContain('Boss')` stays
 * true even when the byline regresses to the real name. That is not
 * hypothetical — the first version of this file asserted exactly that, and it
 * passed against a deliberately broken byline (see the falsification note at
 * the bottom of this file).
 */
function byline(html: string, username = 'ada'): string | null {
  const match = html.match(new RegExp(`<a[^>]*href="/profile/${username}"[^>]*>([^<]*)</a>`));
  return match?.[1] ?? null;
}

/** The author line inside a quoted reply/forward strip. */
function quoteAuthor(html: string): string | null {
  return html.match(/font-semibold text-ink-2">([^<]*)</)?.[1] ?? null;
}

describe('MessageBubble — the byline', () => {
  it('shows the resolved name, not the real one', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={message()} own={false} showSender nameFor={bossResolver} />,
    );

    expect(byline(html)).toBe('Boss');
  });

  it('keeps the real name reachable as a tooltip', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={message()} own={false} showSender nameFor={bossResolver} />,
    );

    expect(html).toContain('title="Ada Lovelace"');
  });

  it('still links to the real profile, because a nickname is not an address', () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={message()} own={false} showSender nameFor={bossResolver} />,
    );

    expect(html).toContain('href="/profile/ada"');
    expect(byline(html)).not.toBe('Ada Lovelace');
  });

  it('falls back to the real name when no resolver is supplied', () => {
    // The live `message:new` path: only `author.name` exists, so the bubble
    // must not render an empty byline.
    const html = renderToStaticMarkup(<MessageBubble message={message()} own={false} showSender />);

    expect(byline(html)).toBe('Ada Lovelace');
    // Nothing was renamed, so there is nothing to disambiguate.
    expect(html).not.toContain('title="Ada Lovelace"');
  });

  it("renders no byline for the viewer's own message", () => {
    const html = renderToStaticMarkup(
      <MessageBubble message={message()} own showSender nameFor={bossResolver} />,
    );

    expect(byline(html)).toBeNull();
  });

  it('renames the author of a quoted reply as well', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={message({
          replyTo: { id: 'm0', sender: GRACE, body: 'Earlier', deleted: false },
        })}
        own={false}
        showSender
        nameFor={bossResolver}
      />,
    );

    // The sender and the quoted author are renamed independently — a single
    // "current sender" name would have put "Boss" on both lines.
    expect(byline(html)).toBe('Boss');
    expect(quoteAuthor(html)).toBe('Chief');
  });

  it("keeps the quote's own fallback when the author is unknown", () => {
    // A socket quote carries `authorName` instead of a full user.
    const html = renderToStaticMarkup(
      <MessageBubble
        message={message({
          replyTo: { id: 'm0', sender: null, authorName: 'Someone Else', body: 'Earlier' },
        })}
        own={false}
        showSender
        nameFor={bossResolver}
      />,
    );

    expect(quoteAuthor(html)).toBe('Someone Else');
  });
});

describe('NicknameEditor', () => {
  const noop = async () => {};

  it('offers Remove only when a nickname exists', () => {
    const withValue = renderToStaticMarkup(
      <NicknameEditor value="Boss" realName="Ada Lovelace" label="Your nickname" onSave={noop} />,
    );
    expect(withValue).toContain('Remove');
    expect(withValue).toContain('value="Boss"');

    const without = renderToStaticMarkup(
      <NicknameEditor value={null} realName="Ada Lovelace" label="Your nickname" onSave={noop} />,
    );
    expect(without).not.toContain('Remove');
    expect(without).toContain('value=""');
  });

  it('shows the real name as the placeholder, so it is clear who is being renamed', () => {
    const html = renderToStaticMarkup(
      <NicknameEditor value={null} realName="Ada Lovelace" label="Your nickname" onSave={noop} />,
    );
    expect(html).toContain('placeholder="Ada Lovelace"');
  });

  it('disables Save until the value actually changes', () => {
    const unchanged = renderToStaticMarkup(
      <NicknameEditor value="Boss" realName="Ada" label="Your nickname" onSave={noop} />,
    );
    expect(unchanged).toContain('disabled');

    const empty = renderToStaticMarkup(
      <NicknameEditor value={null} realName="Ada" label="Your nickname" onSave={noop} />,
    );
    // A blank box must not be submittable — clearing is the explicit button.
    expect(empty).toContain('disabled');
  });

  it('caps the field at the column width so the server cannot reject it', () => {
    const html = renderToStaticMarkup(
      <NicknameEditor value={null} realName="Ada" label="Your nickname" onSave={noop} />,
    );
    // React emits the camelCase attribute name in static markup.
    expect(html).toContain('maxLength="60"');
  });
});

/* ── The member drawer ─────────────────────────────────────────────────── */

function member(overrides: Partial<ConversationMemberView> & { name: string }): ConversationMemberView {
  // A slug username, not the display name: the handle is rendered as `@…`, so
  // reusing the name here would make "how many times does the name appear"
  // assertions count the handle too.
  const slug = overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    user: { ...ADA, id: `u-${slug}`, name: overrides.name, username: slug },
    role: 'MEMBER',
    isMuted: false,
    lastReadAt: '2026-10-08T09:00:00.000Z',
    joinedAt: '2026-10-01T09:00:00.000Z',
    nickname: null,
    contactNickname: null,
    displayName: overrides.name,
    ...overrides,
  };
}

function drawer(props: {
  members: ConversationMemberView[];
  canManage?: boolean;
  avatarUrl?: string | null;
  selfId?: string;
}) {
  return renderToStaticMarkup(
    <ConversationMemberManager
      conversationId="c1"
      title="Design Team"
      avatarUrl={props.avatarUrl ?? null}
      members={props.members}
      canManage={props.canManage ?? false}
      selfId={props.selfId ?? 'u-me'}
      onChanged={() => {}}
    />,
  );
}

describe('ConversationMemberManager — the member list', () => {
  it('renders the resolved name and keeps the real name visible', () => {
    const html = drawer({
      members: [
        member({ name: 'Ada Lovelace', displayName: 'Boss', nickname: 'Boss', user: ADA }),
      ],
    });

    expect(html).toContain('Boss');
    // Renamed members still show who they really are.
    expect(html).toContain('Ada Lovelace');
  });

  it('does not duplicate the name when nothing was changed', () => {
    const renamed = drawer({
      members: [member({ name: 'Ada Lovelace', displayName: 'Boss', nickname: 'Boss' })],
    });
    // A renamed member gets the real name as a secondary label…
    expect(renamed).toContain('· Ada Lovelace');

    const plain = drawer({ members: [member({ name: 'Ada Lovelace' })] });
    // …and an unrenamed one must not get "Ada Lovelace · Ada Lovelace".
    expect(plain).not.toContain('· Ada Lovelace');
  });

  it('marks the viewer in the list', () => {
    const html = drawer({
      members: [member({ name: 'Me', user: { ...ADA, id: 'u-me' } })],
      selfId: 'u-me',
    });
    expect(html).toContain('(you)');
  });
});

describe('ConversationMemberManager — the group photo', () => {
  it('offers Add photo to an admin when there is none', () => {
    const html = drawer({ members: [], canManage: true, avatarUrl: null });
    expect(html).toContain('Add photo');
    expect(html).not.toContain('Remove');
  });

  it('offers Change and Remove once a photo is set', () => {
    const html = drawer({
      members: [],
      canManage: true,
      avatarUrl: '/uploads/avatar/g.webp',
    });
    expect(html).toContain('Change photo');
    expect(html).toContain('Remove');
  });

  it('hides the controls from a plain member and says who can change it', () => {
    const html = drawer({ members: [], canManage: false, avatarUrl: '/uploads/avatar/g.webp' });
    expect(html).not.toContain('Change photo');
    expect(html).not.toContain('Add photo');
    expect(html).toContain('Only an admin can change the group photo');
  });

  it('accepts only the image types the avatar rule allows', () => {
    const html = drawer({ members: [], canManage: true });
    // No SVG: `UPLOAD_RULES.avatar` refuses it, and offering it here would
    // produce a 400 the user cannot explain.
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});

describe('ConversationMemberManager — your own nickname', () => {
  it('is editable by a plain member, since it is their own name', () => {
    const html = drawer({
      members: [member({ name: 'Me', user: { ...ADA, id: 'u-me' } })],
      canManage: false,
      selfId: 'u-me',
    });

    expect(html).toContain('Your nickname');
    // The group photo is admin-only; the nickname is not.
    expect(html).not.toContain('Add photo');
  });
});

/**
 * FALSIFICATION — the checks above were proved able to fail.
 *
 * A passing test proves nothing until you have watched it fail, and this file
 * had a test that could not: the first version asserted `toContain('Boss')` on
 * the byline, and passed while the byline was deliberately changed back to
 * `message.sender.name` — because the AVATAR also renders the resolved name in
 * its `aria-label`. That is why the byline assertions now extract the profile
 * link's text with `byline()` instead of searching the whole document.
 *
 * Three mutations were applied one at a time and reverted:
 *
 *   1. `{senderLabel}` → `{message.sender.name}` in MessageBubble.tsx
 *        → 3 failures (the byline, the tooltip and the quoted-reply cases).
 *   2. `resolved ?? quote.sender?.name` → `quote.sender?.name` in QuoteBlock
 *        → 1 failure (the quoted reply is renamed).
 *   3. the precedence in `resolveDisplayName` swapped so a group nickname beat
 *      the viewer's private one
 *        → 2 failures (tests/display-name.test.ts, tests/message-notify.test.ts).
 *
 * Mutation 1 is the reason `byline()` exists; if a future edit makes these
 * tests pass against a broken byline again, this comment is the explanation.
 */
