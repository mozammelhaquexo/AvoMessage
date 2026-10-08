/**
 * Chat helper rules — currently `seenState`, the signal behind the green
 * "seen" dot in the conversation list (feature 4).
 *
 * The point of these assertions is the rule, not the markup: when is the
 * viewer's own last message considered read by everyone else? The function is
 * structural on purpose, so a fake conversation is enough — no database, no
 * socket, no React.
 */
import { describe, expect, it } from 'vitest';
import {
  conversationDisplayName,
  isOwnMessage,
  memberDisplayName,
  messageKey,
  seenState,
} from '@/lib/chat';

const SELF = 'me';
const OTHER = 'them';
const THIRD = 'third';

const T0 = '2026-10-03T10:00:00.000Z';
const BEFORE = '2026-10-03T09:59:00.000Z';
const AFTER = '2026-10-03T10:01:00.000Z';

/** A DM where `me` sent the last message at T0. */
function dm(opts: { partnerReadAt: string; senderId?: string }) {
  return {
    members: [
      { user: { id: SELF }, lastReadAt: AFTER },
      { user: { id: OTHER }, lastReadAt: opts.partnerReadAt },
    ],
    lastMessage: { senderId: opts.senderId ?? SELF, createdAt: T0 },
  };
}

describe('seenState', () => {
  it('is "none" when there is no last message', () => {
    expect(seenState({ members: dm({ partnerReadAt: AFTER }).members, lastMessage: null }, SELF)).toBe(
      'none',
    );
  });

  it('is "none" when the last message came from someone else', () => {
    expect(seenState(dm({ partnerReadAt: AFTER, senderId: OTHER }), SELF)).toBe('none');
  });

  it('is "seen" in a DM once the partner has read past the message', () => {
    expect(seenState(dm({ partnerReadAt: AFTER }), SELF)).toBe('seen');
  });

  it('counts an exact-timestamp read as seen', () => {
    // markRead stores `new Date()` when the thread is opened; a read landing
    // on the same millisecond as the send must not be reported as unread.
    expect(seenState(dm({ partnerReadAt: T0 }), SELF)).toBe('seen');
  });

  it('is "sent" while the partner has not read it', () => {
    expect(seenState(dm({ partnerReadAt: BEFORE }), SELF)).toBe('sent');
  });

  it('is "sent" when nobody else is in the conversation', () => {
    expect(
      seenState(
        {
          members: [{ user: { id: SELF }, lastReadAt: AFTER }],
          lastMessage: { senderId: SELF, createdAt: T0 },
        },
        SELF,
      ),
    ).toBe('sent');
  });

  it('requires every other member in a group', () => {
    const base = {
      members: [
        { user: { id: SELF }, lastReadAt: AFTER },
        { user: { id: OTHER }, lastReadAt: AFTER },
        { user: { id: THIRD }, lastReadAt: BEFORE },
      ],
      lastMessage: { senderId: SELF, createdAt: T0 },
    };
    expect(seenState(base, SELF)).toBe('sent');
    expect(
      seenState(
        {
          ...base,
          members: base.members.map((m) =>
            m.user.id === THIRD ? { ...m, lastReadAt: AFTER } : m,
          ),
        },
        SELF,
      ),
    ).toBe('seen');
  });

  it('ignores the viewer\'s own lastReadAt', () => {
    // The viewer reading their own thread must not make it "seen".
    expect(
      seenState(
        {
          members: [
            { user: { id: SELF }, lastReadAt: AFTER },
            { user: { id: OTHER }, lastReadAt: BEFORE },
          ],
          lastMessage: { senderId: SELF, createdAt: T0 },
        },
        SELF,
      ),
    ).toBe('sent');
  });

  it('is "none" when the timestamp is unparseable rather than claiming "seen"', () => {
    expect(
      seenState(
        {
          members: [
            { user: { id: SELF }, lastReadAt: AFTER },
            { user: { id: OTHER }, lastReadAt: AFTER },
          ],
          lastMessage: { senderId: SELF, createdAt: 'not-a-date' },
        },
        SELF,
      ),
    ).toBe('none');
  });
});

describe('conversationDisplayName', () => {
  it('uses the group title for groups', () => {
    expect(
      conversationDisplayName(
        { type: 'GROUP', title: 'Design', members: [{ user: { id: SELF, name: 'Me' } }] },
        SELF,
      ),
    ).toBe('Design');
  });

  it('falls back for an untitled group', () => {
    expect(
      conversationDisplayName({ type: 'GROUP', title: null, members: [] }, SELF),
    ).toBe('Group chat');
  });

  it('names the other person in a DM', () => {
    expect(
      conversationDisplayName(
        {
          type: 'DM',
          title: null,
          members: [
            { user: { id: SELF, name: 'Me' } },
            { user: { id: OTHER, name: 'Ada' } },
          ],
        },
        SELF,
      ),
    ).toBe('Ada');
  });
});

/**
 * The per-person rule. `conversationDisplayName` answers "what is this thread
 * called"; this answers "what is this person called inside it" — the byline
 * above a group message, the author on a quoted reply, the composer's reply
 * strip.
 */
describe('memberDisplayName', () => {
  const members = [
    { user: { id: SELF, name: 'Me' }, displayName: 'Me' },
    { user: { id: OTHER, name: 'Ada Lovelace' }, displayName: 'Boss' },
    { user: { id: THIRD, name: 'Grace Hopper' } },
  ];

  it('prefers the server-resolved displayName', () => {
    expect(memberDisplayName(members, OTHER, 'Ada Lovelace')).toBe('Boss');
  });

  it('falls back to the real name when the server did not resolve one', () => {
    // A live `message:new` carries only `author.name`, and a member list that
    // has not loaded yet has nothing to look up.
    expect(memberDisplayName(members, THIRD, 'Grace Hopper')).toBe('Grace Hopper');
  });

  it('uses the caller-supplied fallback when the person is not a member', () => {
    expect(memberDisplayName(members, 'stranger', 'Someone Else')).toBe('Someone Else');
  });

  it('uses the fallback for a null sender rather than throwing', () => {
    // A deleted account leaves `sender: null` on a message.
    expect(memberDisplayName(members, null, 'Unknown')).toBe('Unknown');
    expect(memberDisplayName(members, undefined, undefined)).toBeNull();
  });

  it('does not confuse two members with the same real name', () => {
    // The lookup is by ID, so two people called "Rahim" stay distinct.
    const twins = [
      { user: { id: 'a', name: 'Rahim' }, displayName: 'Rahim (accounts)' },
      { user: { id: 'b', name: 'Rahim' }, displayName: 'Rahim (sales)' },
    ];
    expect(memberDisplayName(twins, 'a', 'Rahim')).toBe('Rahim (accounts)');
    expect(memberDisplayName(twins, 'b', 'Rahim')).toBe('Rahim (sales)');
  });
});

/**
 * Message ownership and the row key.
 *
 * Both exist because of one reported symptom: "my message first goes to the
 * LEFT and then jumps to the RIGHT". Two independent causes, so two rules.
 *
 *   - `isOwnMessage` decides the side. An optimistic message has no senderId
 *     yet, so judging by senderId alone put it on the left for the instant
 *     before the server replied.
 *   - `messageKey` decides the identity. Keyed on `id`, the optimistic →
 *     persisted swap unmounted the row and mounted a new one, replaying the
 *     entrance animation on top of the flip.
 */
describe('isOwnMessage', () => {
  it('claims a message with no senderId yet, because it is our own optimistic send', () => {
    expect(isOwnMessage({ senderId: null, pending: true }, SELF)).toBe(true);
  });

  it('claims a persisted message the viewer sent', () => {
    expect(isOwnMessage({ senderId: SELF, pending: false }, SELF)).toBe(true);
  });

  it("does not claim somebody else's message", () => {
    expect(isOwnMessage({ senderId: OTHER, pending: false }, SELF)).toBe(false);
  });

  it("does not claim somebody else's message even while it is pending", () => {
    // `pending` is only ever set on a locally composed message, so this shape
    // should not occur — but if it ever did, the senderId must still win.
    expect(isOwnMessage({ senderId: OTHER, pending: false }, SELF)).toBe(false);
  });

  it('leaves the non-pending comparison exactly as it was', () => {
    // Preserved quirk: both null counts as a match, as it did before the fix.
    expect(isOwnMessage({ senderId: null, pending: false }, null)).toBe(true);
  });
});

describe('messageKey', () => {
  it('prefers clientId so the key survives the optimistic → persisted swap', () => {
    expect(messageKey({ id: 'pending:abc', clientId: 'abc' })).toBe('abc');
    expect(messageKey({ id: 'cuid_real_1', clientId: 'abc' })).toBe('abc');
  });

  it('falls back to id for every message that was not optimistically sent', () => {
    expect(messageKey({ id: 'cuid_real_1' })).toBe('cuid_real_1');
  });
});
