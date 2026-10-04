/**
 * Navigating out of a chat must be instant and must not disturb the app shell.
 *
 * The reported symptom: clicking a user's name in Messages "feels like a
 * glitch". Two separate causes, both structural rather than cosmetic:
 *
 *   1. the group-chat sender name was a dead `<span>` — clicking it did
 *      nothing at all, and the DM header used `router.push`, which cannot
 *      prefetch;
 *   2. with no loading boundary inside `(app)`, a navigation whose data had not
 *      arrived yet rendered nothing — the route did not commit and the app sat
 *      on the old page looking frozen.
 *
 * The second half is MEASURED, not deduced. `scripts/verify-chat-click-in-browser.mjs`
 * holds the RSC response for 800 ms and reads the live DOM back:
 *
 *   with app/(app)/loading.tsx     → skeleton renders, route commits, shell intact
 *   without app/(app)/loading.tsx  → no skeleton, route commits only when the
 *                                    payload lands (~970 ms later)
 *
 * An earlier version of this comment claimed the root `app/loading.tsx` was
 * taking over and blanking the whole app. That is wrong, and the harness
 * disproves it: the whole-window spinner never appeared during a client-side
 * navigation, with or without this file. It cannot appear — see the last test.
 *
 * Both halves are pinned here, because either one alone brings the glitch back.
 *
 * Source-level assertions rather than a render: `ChatWindow` cannot be mounted
 * without a live realtime provider and a real conversation, and a test that
 * fakes all of that would be asserting on the fake.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('leaving a chat does not replace the app shell', () => {
  it('uses a real prefetched Link for the DM partner, not router.push', () => {
    const src = read('components/chat/ChatWindow.tsx');
    // The programmatic form cannot prefetch — that was the bug.
    expect(src).not.toMatch(/router\.push\(`\/profile\//);
    // The link form is what replaced it.
    expect(src).toMatch(/<Link[\s\S]{0,200}href=\{`\/profile\/\$\{dmPartner\.username\}`\}/);
    expect(src).toMatch(/prefetch/);
  });

  it('opens a group chat\'s members instead of pretending to be a profile link', () => {
    const src = read('components/chat/ChatWindow.tsx');
    expect(src).toMatch(/isGroup \?[\s\S]{0,400}setMembersOpen\(true\)/);
  });

  it('makes the in-thread sender name a real link, not a dead coloured span', () => {
    const src = read('components/chat/MessageBubble.tsx');
    expect(src).toMatch(/<Link[\s\S]{0,200}href=\{`\/profile\/\$\{message\.sender\.username\}`\}/);
  });

  it('has no programmatic profile navigation left anywhere in the chat surface', () => {
    for (const file of ['ChatWindow.tsx', 'MessageBubble.tsx', 'ConversationList.tsx', 'MessagesView.tsx']) {
      const src = read(`components/chat/${file}`);
      expect(src, `${file} navigates to a profile without prefetch`).not.toMatch(
        /router\.(push|replace)\(`\/profile\//,
      );
    }
  });
});

describe('the (app) group has its own, content-area loading boundary', () => {
  it('gives the (app) route group its own loading boundary', () => {
    expect(existsSync(join(ROOT, 'app/(app)/loading.tsx'))).toBe(true);
  });

  it('keeps that boundary in the content area, not the whole viewport', () => {
    const src = read('app/(app)/loading.tsx');
    // `min-h-dvh` + centring is the whole-window spinner. If it reappears here,
    // a slow navigation would cover the chrome instead of filling it.
    expect(src).not.toMatch(/min-h-dvh/);
    expect(src).not.toMatch(/items-center justify-center/);
  });

  it('still keeps the root boundary for the very first request', () => {
    // Before the shell exists there is nothing to preserve, so a full-viewport
    // spinner is correct there.
    const src = read('app/loading.tsx');
    expect(src).toMatch(/min-h-dvh/);
  });

  it('cannot have the root boundary take over a client navigation', () => {
    // Per the bundled `loading.js` reference: "If the layout accesses uncached
    // or runtime data (e.g. cookies(), headers(), or uncached fetches),
    // loading.js will not show a fallback for it ... Navigation blocks until
    // the layout finishes rendering." `(app)/layout.tsx` reads the session,
    // which reads cookies — so the root fallback is structurally unreachable
    // for these routes, and this test fails loudly if that ever stops holding.
    const src = read('app/(app)/layout.tsx');
    expect(src).toMatch(/await getServerSession\(\)/);
  });
});
