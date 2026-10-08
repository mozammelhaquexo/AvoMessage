/**
 * tests/notification-hook-order.test.ts — a source check that no early return
 * can skip a hook in the notification settings components.
 *
 * WHY A SOURCE CHECK AND NOT A RENDER
 * React tests in this repo render with `renderToStaticMarkup` and run in the
 * node environment — there is no jsdom and no @testing-library/react — so a
 * hook-order violation cannot be reproduced by rendering. It does not show up
 * on the first render either: it needs a state update to move the component
 * onto a different branch, and React then throws "Rendered fewer hooks than
 * expected" and takes the page down.
 *
 * THE BUG THIS PINS (found by `eslint`'s `react-hooks/rules-of-hooks`)
 * `DesktopNotificationSetting` starts with `permission === null`, reads the
 * real permission in a mount effect, and returned `null` early when the answer
 * was "denied" — and that early return sat ABOVE two `useCallback`s. So the
 * first render registered six hooks and the second registered four. Any user
 * who had ever clicked "Block" on the notification prompt and then opened
 * Settings got a crash instead of the notifications section.
 *
 * The rule is mechanical — a guard that ends the render must come after the
 * last hook call — so it is checked mechanically. The check is deliberately
 * paired with a test that proves it can fail (see the falsification block at
 * the bottom).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = join(process.cwd(), 'components/notifications/DesktopNotificationSetting.tsx');

/** Every React hook call this file could plausibly use. */
const HOOK_CALL =
  /\buse(?:State|Effect|Callback|Memo|Ref|SyncExternalStore|Reducer|LayoutEffect|Id|Context|Transition|DeferredValue)\s*\(/g;

/** `if (…) return null;` / `if (…) return;` — a guard that ends the render. */
const GUARD = /^[ \t]*if \([^)]*\)[ \t]*return\b[^;]*;/gm;

/** Index of the last hook call in `source`, or -1. */
function lastHookIndex(source: string): number {
  let index = -1;
  for (const match of source.matchAll(HOOK_CALL)) {
    index = Math.max(index, match.index);
  }
  return index;
}

/** Index of the first early-return guard in `source`, or -1. */
function firstGuardIndex(source: string): number {
  /*
   * A FRESH regex per call, and deliberately without `g`.
   *
   * A module-level `/g` regex carries `lastIndex` between `exec()` calls, so
   * the second call on the same string resumes from where the first stopped,
   * finds nothing, and returns -1. That made the main assertion below skip
   * every component and pass vacuously — it reported success while the bug it
   * was written for was still present. Caught by the falsification block at
   * the bottom of this file, which is exactly why that block exists.
   */
  const match = new RegExp(GUARD.source, 'm').exec(source);
  return match ? match.index : -1;
}

/** Split a module into its top-level `export function` bodies. */
function componentBodies(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  // Non-greedy up to the first line that is exactly `}` — the end of a
  // top-level function. Anything past that belongs to the next one.
  for (const match of source.matchAll(/^export function (\w+)\([\s\S]*?^\}/gm)) {
    out.push({ name: match[1]!, body: match[0] });
  }
  return out;
}

const source = readFileSync(FILE, 'utf8');
const components = componentBodies(source);

describe('the source check itself', () => {
  it('finds the components it claims to be checking', () => {
    // If the file is renamed or a component is added, this fails loudly rather
    // than silently checking nothing — the failure mode of every source check.
    expect(components.map((c) => c.name)).toEqual([
      'DesktopNotificationSetting',
      'DesktopNotificationPrompt',
    ]);
  });

  it('recognises a hook call and an early return', () => {
    // Both helpers must actually match something, or every assertion below
    // would pass vacuously.
    expect(lastHookIndex(components[0]!.body)).toBeGreaterThan(0);
    expect(firstGuardIndex(components[0]!.body)).toBeGreaterThan(0);
  });

  it('gives the same answer every time it is asked', () => {
    /*
     * This is the check that caught the check being wrong.
     *
     * A module-level `/g` regex carries `lastIndex` between `exec()` calls, so
     * a second call on the same string resumed from the previous match, found
     * nothing, and returned -1 — and the main assertion treated -1 as "this
     * component has no guard" and skipped it. The suite went green with the
     * bug still in the file. Comparing repeated calls makes that impossible to
     * reintroduce quietly.
     */
    const body = components[0]!.body;
    const guard = firstGuardIndex(body);
    const hook = lastHookIndex(body);

    expect(guard).toBeGreaterThan(0);
    expect(firstGuardIndex(body)).toBe(guard);
    expect(firstGuardIndex(body)).toBe(guard);
    expect(lastHookIndex(body)).toBe(hook);
    expect(lastHookIndex(body)).toBe(hook);
  });
});

describe('hook order in the notification settings components', () => {
  it('never places an early return above a hook', () => {
    for (const { name, body } of components) {
      const guard = firstGuardIndex(body);
      const hook = lastHookIndex(body);
      // A component with no guard, or no hooks, has nothing to violate.
      if (guard === -1 || hook === -1) continue;

      expect(
        guard,
        `${name}: the guard at offset ${guard} comes before the last hook at ${hook}, ` +
          'so the second render registers fewer hooks than the first and React throws.',
      ).toBeGreaterThan(hook);
    }
  });

  it('keeps the unsupported-browser guard below both callbacks', () => {
    // The exact regression. `!supported` becomes true on the render after the
    // mount effect reads a "denied" permission.
    const setting = components.find((c) => c.name === 'DesktopNotificationSetting')!;
    const guard = setting.body.indexOf('if (!supported) return null;');

    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(lastHookIndex(setting.body));
  });

  it('keeps the prompt guard below its hook', () => {
    const prompt = components.find((c) => c.name === 'DesktopNotificationPrompt')!;
    const guard = prompt.body.indexOf('if (permission !== "default" || dismissed) return null;');

    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(lastHookIndex(prompt.body));
  });
});

describe('falsification: the check can actually fail', () => {
  /*
   * A source check that cannot fail is worse than no check, because it reads
   * like coverage. These two cases run the same logic over a mutated copy of
   * the real component, with the guard moved back above the callbacks — which
   * is precisely the code that shipped and crashed.
   */
  function withGuardMovedUp(): string {
    const setting = components.find((c) => c.name === 'DesktopNotificationSetting')!;
    const guard = '  if (!supported) return null;\n';
    const withoutGuard = setting.body.replace(guard, '');

    /*
     * Insert at the START OF THE LINE holding the first hook, not at the hook's
     * own offset. Splicing at the offset splits `const enabled = ` from
     * `useSyncExternalStore(` and leaves the guard mid-line, where the
     * `^[ \t]*if` anchor cannot see it — `firstGuardIndex` then returns -1 and
     * this test fails for a reason that has nothing to do with hook order.
     */
    const firstHook = withoutGuard.search(HOOK_CALL);
    const lineStart = withoutGuard.lastIndexOf('\n', firstHook) + 1;

    return `${withoutGuard.slice(0, lineStart)}${guard}${withoutGuard.slice(lineStart)}`;
  }

  it('flags the guard when it is moved back above the hooks', () => {
    const mutated = withGuardMovedUp();

    expect(lastHookIndex(mutated)).toBeGreaterThan(0);
    expect(firstGuardIndex(mutated)).toBeGreaterThan(-1);
    // The property the real test asserts must now be violated.
    expect(firstGuardIndex(mutated)).toBeLessThan(lastHookIndex(mutated));
  });

  it('flags a hook that appears only after the guard', () => {
    // The same shape, written by hand, to show the check is not keyed to this
    // one string.
    const sample = [
      'export function Widget() {',
      '  const [ready, setReady] = useState(false);',
      '  if (!ready) return null;',
      '  const onGo = useCallback(() => setReady(true), []);',
      '  return null;',
      '}',
    ].join('\n');

    const body = componentBodies(sample)[0]!;
    expect(firstGuardIndex(body.body)).toBeLessThan(lastHookIndex(body.body));
  });
});
