# AvoMessage — Design Tokens (DESIGN_TOKENS)

> Initial token proposal for the design-system agent. Tokens are the **only**
> way colors/spacing/type enter components — no hardcoded values in UI code.
> Implemented as CSS custom properties + Tailwind theme extension.

## 1. Brand decision: why avocado-lime green

The product is **Avo**Message. Candidate primaries were evaluated:

| Option | Verdict |
|---|---|
| Corporate blue (Twitter/X, LinkedIn, Facebook) | ❌ Indistinguishable from incumbents |
| Red/coral (YouTube, Instagram gradients) | ❌ Aggressive; moderation UI needs red for danger |
| Purple (futuristic but cold) | ❌ Less friendly; accessibility contrast is harder |
| **Avocado → lime green** | ✅ **Chosen** |

**Rationale:** lime/avocado green is ownable (no major social platform owns green as primary),
signals *fresh, energetic, alive* (social) while remaining *natural, trustworthy* (collaboration).
It renders vibrantly in dark mode (neon-lime accents read "futuristic") and stays WCAG-AA-safe
in light mode at 600–700 weights. Secondary deep-teal grounds it for enterprise/company surfaces.

**Primary hue family:** lime — light mode `lime-600 #65A30D` (text/actions), vibrant accents `lime-500 #84CC16` / `lime-400 #A3E635` (dark mode, glows).

## 2. Color — semantic tokens

Format: `--token: light-value;` with dark overrides under `[data-theme="dark"]`.
Tailwind maps: `bg-brand`, `text-brand`, `bg-surface-1`, `border-line`, etc.

### Brand
| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-strong` | `#4D7C0F` (lime-700) | `#A3E635` (lime-400) | Primary text on light / fills on dark |
| `--brand` | `#65A30D` (lime-600) | `#84CC16` (lime-500) | Primary buttons, links, active states |
| `--brand-soft` | `#ECFCCB` (lime-100) | `#1A2E05` (lime-950) | Tinted backgrounds, badges |
| `--brand-glow` | — | `0 0 24px rgba(132,204,22,.35)` | Dark-mode futuristic glow on primary CTAs |

### Accent (company/enterprise surfaces)
| Token | Light | Dark |
|---|---|---|
| `--accent` | `#0F766E` (teal-700) | `#2DD4BF` (teal-400) |
| `--accent-soft` | `#CCFBF1` (teal-100) | `#042F2E` (teal-950) |

### Surfaces & text
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg-base` | `#FAFAF8` (warm paper) | `#0C0F0A` (near-black, green-tinted) | App background |
| `--bg-surface-1` | `#FFFFFF` | `#131711` | Cards, panels |
| `--bg-surface-2` | `#F4F6EF` | `#1B211A` | Hover, inset areas, inputs |
| `--bg-overlay` | `rgba(12,15,10,.5)` | `rgba(0,0,0,.65)` | Modals, drawers |
| `--text-1` | `#1A2013` | `#F2F5EA` | Primary text |
| `--text-2` | `#4D5A3F` | `#B9C4A8` | Secondary text |
| `--text-3` | `#8A937C` | `#6E7860` | Muted/placeholder |
| `--line` | `#E4E8D9` | `#2A3126` | Borders, dividers |
| `--line-strong` | `#CBD2B8` | `#3D4636` | Emphasized borders |

### Status (fixed across themes)
| Token | Value | Use |
|---|---|---|
| `--success` | `#16A34A` | Confirmed, delivered |
| `--warning` | `#D97706` | Pending, unverified |
| `--danger` | `#DC2626` | Destructive, errors, reports |
| `--info` | `#0284C7` | Informational |
| `--online` | `#65A30D` | Presence online |
| `--away` | `#D97706` | Presence away |
| `--dnd` | `#DC2626` | Do-not-disturb |
| `--offline` | `#9CA3AF` | Presence offline |

### Message bubbles (chat identity)
| Token | Light | Dark |
|---|---|---|
| `--bubble-own` | `#D9F99D` (lime-200) | `#365314` (lime-900) |
| `--bubble-their` | `#FFFFFF` / surface-1 | `#1B211A` (surface-2) |

## 3. Typography

- **Font family:** `--font-sans: "Inter", system-ui…` for UI; `--font-display: "Sora"` or "Space Grotesk" for brand headlines/landing (futuristic edge). Mono: `ui-monospace` for codes/tokens.
- **Scale (1.250 major-third):**

| Token | Size / line-height | Use |
|---|---|---|
| `--text-display` | 40px / 1.1 | Landing hero |
| `--text-h1` | 32px / 1.2 | Page titles |
| `--text-h2` | 24px / 1.3 | Section titles |
| `--text-h3` | 20px / 1.35 | Card titles |
| `--text-body` | 16px / 1.5 | Body |
| `--text-body-sm` | 14px / 1.45 | Feed text, messages |
| `--text-caption` | 12px / 1.4 | Meta, timestamps |
| `--text-tiny` | 11px / 1.3 | Badges, overlines |

- Weights: 400 body, 500 medium (emphasis), 600 semibold (headings/buttons), 700 display only.

## 4. Spacing, radius, borders

- **Spacing:** 4px base, scale `--space-1:4px … --space-16:64px` (Tailwind default scale kept).
- **Radius:**

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | Inputs, small chips |
| `--radius-md` | 10px | Buttons, cards |
| `--radius-lg` | 16px | Panels, modals |
| `--radius-xl` | 24px | Sheets, hero cards |
| `--radius-full` | 999px | Avatars, pills, FABs |

- **Borders:** 1px `--line`; focus ring `2px var(--brand)` with 2px offset; never remove outlines without replacement.

## 5. Shadows & elevation

| Token | Light | Dark |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(26,32,19,.06)` | `0 1px 2px rgba(0,0,0,.4)` |
| `--shadow-md` | `0 4px 12px rgba(26,32,19,.08)` | `0 4px 16px rgba(0,0,0,.5)` |
| `--shadow-lg` | `0 12px 32px rgba(26,32,19,.12)` | `0 12px 40px rgba(0,0,0,.6)` |
| `--shadow-pop` | `0 8px 24px rgba(101,163,13,.25)` | brand glow (see §2) |

## 6. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 80ms | Press states |
| `--dur-fast` | 150ms | Hovers, toggles |
| `--dur-base` | 250ms | Drawers, toasts, message send |
| `--dur-slow` | 400ms | Page transitions, modals |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | Entrances (expressive, snappy) |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | Exits, loops |

Rules: respect `prefers-reduced-motion` (disable non-essential animation); typing indicator uses pulse at `--dur-slow`; never animate layout-triggering properties on feed rows.

## 7. Z-index layers

| Token | Value | Layer |
|---|---|---|
| `--z-base` | 0 | Page content |
| `--z-sticky` | 10 | Sticky headers, composer |
| `--z-dropdown` | 30 | Menus, popovers, emoji picker |
| `--z-drawer` | 40 | Side panels |
| `--z-modal` | 50 | Dialogs, lightbox |
| `--z-toast` | 60 | Toasts |
| `--z-call` | 70 | Active call overlay (always top) |
| `--z-tooltip` | 80 | Tooltips |

## 8. Breakpoints

| Token | Value | Target |
|---|---|---|
| `--bp-sm` | 640px | Large phones |
| `--bp-md` | 768px | Tablets — sidebar collapses to rail |
| `--bp-lg` | 1024px | Desktop — 3-column (nav/feed/aside) |
| `--bp-xl` | 1280px | Wide — max content width 1200px |
| `--bp-2xl` | 1536px | Ultra-wide |

Mobile-first: bottom tab bar < `md`; call UI full-screen < `md`.

## 9. Dark mode strategy

`data-theme="dark"` on `<html>`, toggled by user setting (default: system). All semantic
tokens swap; status colors stay fixed. Images get `filter: brightness(.92)` in dark via
a utility class. Persist choice in `localStorage` + user settings (server) when logged in.

## 10. Component notes for the design-system agent

- Build primitives first: Button, Input, Avatar, Badge, Modal, Toast, Tabs, Dropdown, Spinner, EmptyState.
- Chat primitives: `MessageBubble` (own/their variants), `TypingIndicator`, `VoicePlayer` (waveform), `PresenceDot`.
- Feed primitives: `PostCard`, `Composer`, `CommentThread`, `ReactionBar`.
- Company primitives: `MemberRow` (role badge), `InviteDialog`, `RoleSelect`.
- Every interactive primitive ships light+dark stories and a11y (focus-visible, aria-labels, 44px touch targets on mobile).
