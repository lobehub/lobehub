// Import ORDER is load-bearing and must not be reshuffled: the desktop boot
// evaluates structural fallbacks and the navigation facade
// (`NavigatorRegistrar.desktop` → `appNavigate` → `activeTabNavigate`) before
// the router config. If either graph statically pulls `desktopRouter.config`
// back in, the Electron adapter can evaluate `redirectElement(...)` or a
// platform route component while its dependency is still initializing and
// leave the renderer white-screened with a TDZ error.
import '@/components/Skeleton/RouteSegment';
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
