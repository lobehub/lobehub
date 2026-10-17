import { HomeIcon, Image, ImageIcon, Video } from 'lucide-react';
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

    expect(staticMeta.icon).toBe(HomeIcon);
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

  it.each([
    ['/image', Image, 'navigation.image'],
    ['/video', Video, 'navigation.video'],
  ])('uses the generation page title and icon for %s', (path, icon, titleKey) => {
    const { static: staticMeta } = matchRouteMeta(mainAreaMetaRoutes, path);

    expect(staticMeta.icon).toBe(icon);
    expect(staticMeta.titleKey).toBe(titleKey);
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

  it('resolves project conversation meta with a dynamic title runner', () => {
    const matched = matchRouteMeta(mainAreaMetaRoutes, '/project/prj_1/conversation/tpc_1');

    expect(matched.static.titleKey).toBe('project:topics.title');
    expect(matched.static.icon).toBeDefined();
    expect(matched.meta?.DynamicMeta).toBeDefined();
    expect(matched.params.projectId).toBe('prj_1');
    expect(matched.params.topicId).toBe('tpc_1');
  });

  // Regression: the project acceptance section reused `acceptanceRouteMeta`,
  // whose DynamicMeta cannot read an `:acceptanceId` here, so every project
  // acceptance tab was persisted with the generic fallback title.
  it('resolves project acceptance meta with its own static title and no runner', () => {
    const matched = matchRouteMeta(mainAreaMetaRoutes, '/project/prj_1/acceptance');

    expect(matched.static.titleKey).toBe('project:sections.acceptance');
    expect(matched.static.icon).toBeDefined();
    expect(matched.meta?.DynamicMeta).toBeUndefined();
  });

  it('resolves project meta for workspace-scoped tab urls', () => {
    const matched = matchRouteMeta(mainAreaMetaRoutes, '/team-x/project/prj_1/conversation/tpc_1');

    expect(matched.static.titleKey).toBe('project:topics.title');
    expect(matched.params.projectId).toBe('prj_1');
  });
});
