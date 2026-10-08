import type { MetadataRoute } from 'next';

/**
 * app/manifest.ts — the web app manifest.
 *
 * TWO REASONS IT IS HERE, BOTH FUNCTIONAL
 *
 *   1. Push notifications. `registration.showNotification()` is what draws a
 *      notification when the tab is closed, and browsers only honour an icon
 *      they can resolve. A manifest with 192px and 512px PNGs is also what
 *      makes the site installable, and an installed app is what
 *      `navigator.setAppBadge()` needs to show an unread count on the taskbar
 *      icon.
 *
 *   2. It gives the OS a name and a colour for the window when the app is
 *      installed, instead of the raw origin.
 *
 * `theme_color`/`background_color` are the light-theme surface tokens from
 * app/globals.css; the manifest format has no way to express a per-scheme
 * colour, so the light values win — a dark splash on a light install would look
 * broken more often than the reverse.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AvoMessage',
    short_name: 'AvoMessage',
    description:
      'AvoMessage — social messaging and company collaboration. Chat, call, share, and work together in one place.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fafaf8',
    theme_color: '#65a30d',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        // Android crops maskable icons to a circle; this variant has the mark
        // inset so nothing important is cut off.
        purpose: 'maskable',
      },
    ],
  };
}
