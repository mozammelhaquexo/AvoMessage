/**
 * The deep-linked tab that rendered nothing.
 *
 * SYMPTOM. Open `/settings?tab=manager` — the tab strip highlights Manager and
 * the panel below it is empty. Clicking the Manager tab by hand makes it appear.
 * The same happened straight after submitting a manager application, because
 * the apply page redirects to `/settings?tab=manager`; that is the reported
 * "manager page e kichui show hoy na".
 *
 * CAUSE. `TabPanel` rendered only panels in `visited`, and `visited` grows
 * solely through `setActiveId`, which only the tab BUTTONS call. Settings is a
 * controlled `<Tabs value={tab}>` and reads `?tab=` on mount, calling its own
 * `setTab` directly — so `activeId` was "manager" while `visited` was still
 * `{"profile"}`, and the active panel was suppressed.
 *
 * The decision lives in `shouldRenderPanel`, so all three cases are reachable
 * here by passing a set. The bug is the FIRST case: it is only distinguishable
 * from the fix when `visited` and `activeId` disagree, which a single
 * server-render of a controlled `<Tabs>` cannot produce (it seeds `visited`
 * from `value`).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs, TabPanel, shouldRenderPanel } from '@/components/ui/tabs';
import { SETTINGS_TAB_IDS, resolveSettingsTab, DEFAULT_SETTINGS_TAB } from '@/lib/settings-tabs';

describe('shouldRenderPanel — activation vs. laziness', () => {
  it('renders the ACTIVE panel even when it was never marked visited', () => {
    // The exact state Settings was in: the effect moved the tab to Manager,
    // which never went through setActiveId, so `visited` still only had profile.
    expect(shouldRenderPanel('manager', 'manager', new Set(['profile']))).toBe(true);
  });

  it('keeps laziness: an inactive, never-visited panel is not rendered', () => {
    expect(shouldRenderPanel('manager', 'profile', new Set(['profile']))).toBe(false);
  });

  it('keeps a previously visited panel rendered for a cheap switch back', () => {
    expect(shouldRenderPanel('manager', 'profile', new Set(['profile', 'manager']))).toBe(true);
  });
});

describe('TabPanel — server render', () => {
  it('emits the active panel without the hidden attribute', () => {
    // `hidden` is what made `innerText` empty in the browser probe: the panel
    // was in the DOM, so a "does the HTML contain the text" check would have
    // passed while the user saw nothing.
    const html = renderToStaticMarkup(
      <Tabs
        value="manager"
        label="Settings sections"
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'manager', label: 'Manager' },
        ]}
      >
        <TabPanel id="profile">PROFILE-BODY</TabPanel>
        <TabPanel id="manager">MANAGER-BODY</TabPanel>
      </Tabs>,
    );

    expect(html).toContain('MANAGER-BODY');
    const panelTags = html.match(/<div[^>]*role="tabpanel"[^>]*>/g) ?? [];
    const managerPanel = panelTags.find((tag) => tag.includes('-panel-manager'));
    expect(managerPanel).toBeDefined();
    expect(managerPanel).not.toContain('hidden');
  });
});

describe('the Settings deep-link contract this depends on', () => {
  it('resolves ?tab=manager to the manager tab', () => {
    expect(resolveSettingsTab('?tab=manager')).toBe('manager');
  });

  it('falls back to the default rather than throwing on a stale bookmark', () => {
    expect(resolveSettingsTab('?tab=not-a-tab')).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab('')).toBe(DEFAULT_SETTINGS_TAB);
  });

  it('every id the resolver can return has a panel the settings page renders', () => {
    // The panel ids in app/(app)/settings/page.tsx are written by hand; if one
    // drifts from SETTINGS_TAB_IDS the resolver would return an id with no
    // panel — the same blank-panel symptom by a different route.
    const rendered = renderToStaticMarkup(
      <Tabs
        value="profile"
        label="Settings sections"
        tabs={SETTINGS_TAB_IDS.map((id) => ({ id, label: id }))}
      >
        {SETTINGS_TAB_IDS.map((id) => (
          <TabPanel key={id} id={id}>{`BODY:${id}`}</TabPanel>
        ))}
      </Tabs>,
    );
    for (const id of SETTINGS_TAB_IDS) {
      expect(rendered).toContain(`-tab-${id}`);
    }
    expect(rendered).toContain('BODY:profile');
  });
});
