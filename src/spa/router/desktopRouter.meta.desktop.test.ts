import { ImageIcon, MessageSquarePlus } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { matchRouteMeta } from '@/features/Electron/titlebar/TabBar/resolveRouteMeta';

import { mainAreaMetaRoutes } from './desktopRouter.config.desktop';

// vitest does not apply the platformResolve Vite plugin, so the Electron adapter
// must be imported by its explicit `.desktop` path. This guards Critical 1: the
// electron root router's `/` children are slim null stubs with zero meta, so a
// meta tree that aliased those stubs would silently degrade every tab title to
// brand and every icon to the Circle fallback on the packaged app.
describe('mainAreaMetaRoutes (Electron adapter)', () => {
  it('uses Home for the personal Home tab and document title', () => {
    const { static: staticMeta } = matchRouteMeta(mainAreaMetaRoutes, '/');

    expect(staticMeta.icon).toBe(MessageSquarePlus);
    expect(staticMeta.tabTitleKey).toBe('navigation.home');
    expect(staticMeta.titleKey).toBe('navigation.home');
  });

  it('resolves a static settings meta from the electron build meta tree', () => {
    const { static: staticMeta } = matchRouteMeta(mainAreaMetaRoutes, '/settings/profile');

    expect(staticMeta.titleKey).toBeDefined();
    expect(staticMeta.icon).toBeDefined();
  });

  it('uses the active resource category for the tab title and icon', () => {
    const { static: staticMeta } = matchRouteMeta(mainAreaMetaRoutes, '/resource/images');

    expect(staticMeta.titleKey).toBe('navigation.resourceImages');
    expect(staticMeta.icon).toBe(ImageIcon);
  });

  it('resolves a static agent meta and its DynamicMeta runner', () => {
    const matched = matchRouteMeta(mainAreaMetaRoutes, '/agent/agt_1');

    expect(matched.static.titleKey).toBe('navigation.chat');
    expect(matched.static.icon).toBeDefined();
    expect(matched.meta?.DynamicMeta).toBeDefined();
    expect(matched.params.aid).toBe('agt_1');
  });

  it('resolves meta for workspace-scoped tab urls', () => {
    const { static: staticMeta } = matchRouteMeta(mainAreaMetaRoutes, '/team-x/agent/agt_2');

    expect(staticMeta.titleKey).toBe('navigation.chat');
    expect(staticMeta.icon).toBeDefined();
  });
});
