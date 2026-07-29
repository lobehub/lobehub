// Import ORDER is load-bearing and must not be reshuffled: the desktop boot
// evaluates the navigation facade (`NavigatorRegistrar.desktop` → `appNavigate`
// → `activeTabNavigate`) before the router config. If any of those statically
// pull `desktopRouter.config` back in, the config twin runs its top-level
// `redirectElement(...)` while `@/utils/router` is still initializing and hits
// a jsx-runtime TDZ ("Cannot access '_jsxDEV' before initialization"), leaving
// the renderer white-screened. This test wires that order up so a regression in
// the navigation import graph fails here instead of only on the packaged app.
import '@/utils/NavigatorRegistrar.desktop';

import { describe, expect, it } from 'vitest';

import {
  createMainAreaChildren,
  desktopRoutes,
  mainAreaMetaRoutes,
} from './desktopRouter.config.desktop';

describe('desktop boot init order', () => {
  it('evaluates desktopRouter.config after the navigation facade without a TDZ crash', () => {
    expect(Array.isArray(desktopRoutes)).toBe(true);
    expect(desktopRoutes.length).toBeGreaterThan(0);

    expect(Array.isArray(mainAreaMetaRoutes)).toBe(true);
    expect(mainAreaMetaRoutes.length).toBeGreaterThan(0);

    expect(createMainAreaChildren().length).toBeGreaterThan(0);
  });
});
