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
import { conversationDisplayName, seenState } from '@/lib/chat';

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
