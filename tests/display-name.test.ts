/**
 * lib/display-name.ts — the precedence rule for what to call somebody.
 *
 * WHY THIS IS TESTED ON ITS OWN
 * Three nullable sources can name the same person, and the order they are
 * consulted in is the entire feature. The rule is pure, so it can be pinned
 * exhaustively here rather than inferred from a database fixture — and the
 * order matters in a way users notice immediately: get it wrong and the same
 * person appears under two different names in the same session, or a nickname
 * you deliberately set is silently ignored.
 *
 * The order is:
 *   1. the viewer's private rename,
 *   2. the member's own nickname inside this group,
 *   3. the real name.
 */
import { describe, expect, it } from 'vitest';
import { resolveDisplayName } from '@/lib/display-name';

const REAL = 'Abdur Rahim';

describe('resolveDisplayName', () => {
  it('uses the real name when nothing else is set', () => {
    expect(resolveDisplayName({ realName: REAL })).toBe(REAL);
    expect(
      resolveDisplayName({ realName: REAL, groupNickname: null, contactNickname: null }),
    ).toBe(REAL);
  });

  it("prefers the member's own group nickname over the real name", () => {
    expect(resolveDisplayName({ realName: REAL, groupNickname: 'Boss' })).toBe('Boss');
  });

  it("prefers the viewer's private rename over everything else", () => {
    // The private rename wins because it is the most deliberate choice by the
    // person doing the looking, and the only one that is theirs alone to make.
    expect(
      resolveDisplayName({
        realName: REAL,
        groupNickname: 'Boss',
        contactNickname: 'Rahim (accounts)',
      }),
    ).toBe('Rahim (accounts)');
  });

  it('falls through a blank nickname rather than rendering nobody', () => {
    // A legacy write or a hand-edited database can hold "". Treating it as a
    // name would show an empty label, which reads as a bug to the user.
    expect(resolveDisplayName({ realName: REAL, groupNickname: '' })).toBe(REAL);
    expect(resolveDisplayName({ realName: REAL, contactNickname: '' })).toBe(REAL);
    expect(resolveDisplayName({ realName: REAL, contactNickname: '   ' })).toBe(REAL);
  });

  it('falls through a blank private rename to the group nickname, not straight to the real name', () => {
    // Each source is skipped independently; one blank must not discard the
    // next one down.
    expect(
      resolveDisplayName({ realName: REAL, contactNickname: '', groupNickname: 'Boss' }),
    ).toBe('Boss');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveDisplayName({ realName: REAL, groupNickname: '  Boss  ' })).toBe('Boss');
    expect(resolveDisplayName({ realName: REAL, contactNickname: ' Boss ' })).toBe('Boss');
  });

  it('keeps an unusual but deliberate nickname exactly as given', () => {
    // Not every nickname is a tidy word — emoji, dots and single characters
    // are all legitimate, and none of them should be "helpfully" rewritten.
    expect(resolveDisplayName({ realName: REAL, contactNickname: '🚀' })).toBe('🚀');
    expect(resolveDisplayName({ realName: REAL, contactNickname: 'R.' })).toBe('R.');
    expect(resolveDisplayName({ realName: REAL, groupNickname: 'ভাই' })).toBe('ভাই');
  });
});
