import { describe, expect, it } from 'vitest';

import { desktopRoutes as webDesktopRoutes } from '@/spa/router/desktopRouter.config';
import { desktopRoutes as electronDesktopRoutes } from '@/spa/router/desktopRouter.config.desktop';

import { isMainLayoutLocation } from './routeScope';

const variants: Array<[string, typeof webDesktopRoutes]> = [
  ['Web', webDesktopRoutes],
  ['Electron', electronDesktopRoutes],
];

// Paths that render the nav panel + rounded container the shell imitates.
const MAIN_LAYOUT_PATHS = ['/', '/agent/agent-1', '/settings/memory', '/acme/settings/oauth-apps'];

describe('isMainLayoutLocation', () => {
  it.each(variants)('%s recognises main-layout urls', (_, routes) => {
    for (const pathname of MAIN_LAYOUT_PATHS) {
      expect(isMainLayoutLocation(routes, pathname), `${pathname} is main layout`).toBe(true);
    }
  });

  // The shell would otherwise promise chrome these pages never render — the
  // exact "logo → app-shell skeleton → logo → page" sequence this guards.
  it.each([
    ['Web', webDesktopRoutes, ['/onboarding', '/verify-im']],
    ['Electron', electronDesktopRoutes, ['/desktop-onboarding']],
  ])('%s excludes standalone routes outside the main layout', (_, routes, paths) => {
    for (const pathname of paths as string[]) {
      expect(isMainLayoutLocation(routes as never, pathname), `${pathname} is standalone`).toBe(
        false,
      );
    }
  });

  it('honours the debug-proxy basename', () => {
    const base = '/_dangerous_local_dev_proxy';

    expect(isMainLayoutLocation(webDesktopRoutes, `${base}/agent/agent-1`, base)).toBe(true);
    // Without it the prefix is eaten as a `:workspaceSlug`, so `/onboarding`
    // stops being recognised as standalone — which is why the entry must pass it.
    expect(isMainLayoutLocation(webDesktopRoutes, `${base}/onboarding`, base)).toBe(false);
    expect(isMainLayoutLocation(webDesktopRoutes, `${base}/onboarding`)).toBe(true);
  });

  // Not a "known route" test: the main area carries a `:workspaceSlug` segment,
  // so an unrecognised path really does render the main layout and the shell is
  // the right placeholder for it.
  it('treats an unrecognised path as a workspace inside the main layout', () => {
    expect(isMainLayoutLocation(webDesktopRoutes, '/_nonexistent_top_level')).toBe(true);
  });
});
