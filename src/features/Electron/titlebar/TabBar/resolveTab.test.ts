import { Circle, MessageSquare } from 'lucide-react';
import { type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { type RouteMeta } from '@/spa/router/routeMeta';

import { resolveTab } from './hooks/useResolvedTabs';
import { type TabItem } from './types';

const agentMeta: RouteMeta = { icon: MessageSquare, titleKey: 'navigation.chat' };

const fixtureRoutes: RouteObject[] = [
  {
    children: [
      {
        handle: {
          meta: { tabTitleKey: 'navigation.home', titleKey: 'navigation.home' },
        },
        index: true,
      },
      { handle: { meta: agentMeta }, path: 'agent/:aid' },
      { path: 'group/:gid' },
    ],
    path: '/',
  },
];

const t = (key: string) => key;

const tab = (url: string, cached?: TabItem['cached']): TabItem => ({
  cached,
  id: url,
  lastVisited: 1,
  url,
});

describe('resolveTab', () => {
  it('cold start: falls back to the snapshot when stores are empty', () => {
    const resolved = resolveTab(
      fixtureRoutes,
      tab('/agent/abc', { avatar: 'a.png', title: 'Cached Agent' }),
      false,
      t,
    );
    expect(resolved.meta.title).toBe('Cached Agent');
    expect(resolved.meta.avatar).toBe('a.png');
    expect(resolved.meta.icon).toBe(MessageSquare);
  });

  it('carries a project avatar seed from the snapshot and the live meta', () => {
    const cold = resolveTab(fixtureRoutes, tab('/agent/abc', { avatarSeed: 'Alpha' }), false, t);
    expect(cold.meta.avatarSeed).toBe('Alpha');

    const live = resolveTab(
      fixtureRoutes,
      tab('/agent/abc', { avatarSeed: 'Old name' }),
      true,
      t,
      { avatarSeed: 'Alpha' },
      '/agent/abc',
    );
    expect(live.meta.avatarSeed).toBe('Alpha');
  });

  it('carries the workspace avatar kind from the snapshot', () => {
    const cold = resolveTab(
      fixtureRoutes,
      tab('/agent/abc', { avatarKind: 'workspace', title: 'Acme' }),
      false,
      t,
    );
    expect(cold.meta.avatarKind).toBe('workspace');
    expect(cold.meta.avatar).toBeUndefined();
  });

  it('active tab: a live null avatar hides the cached one', () => {
    const resolved = resolveTab(
      fixtureRoutes,
      tab('/agent/abc', { avatar: 'logo.png', avatarSeed: 'Alpha' }),
      true,
      t,
      { avatar: null, avatarSeed: 'Alpha' },
      '/agent/abc',
    );
    expect(resolved.meta.avatar).toBeUndefined();
    expect(resolved.meta.avatarSeed).toBe('Alpha');
  });

  it('active tab: live dynamic meta overlays the snapshot', () => {
    const resolved = resolveTab(
      fixtureRoutes,
      tab('/agent/abc', { title: 'Stale Cached' }),
      true,
      t,
      { title: 'Live Title' },
      '/agent/abc',
    );
    expect(resolved.meta.title).toBe('Live Title');
  });

  it('active tab: ignores live dynamic meta resolved for another tab', () => {
    const resolved = resolveTab(
      fixtureRoutes,
      tab('/agent/abc', { title: 'Cached Title' }),
      true,
      t,
      { title: 'Other Live Title' },
      '/agent/def',
    );
    expect(resolved.meta.title).toBe('Cached Title');
  });

  it('inactive tab: live dynamic meta is ignored', () => {
    const resolved = resolveTab(
      fixtureRoutes,
      tab('/agent/abc', { title: 'Cached Title' }),
      false,
      t,
      { title: 'Live Title' },
      '/agent/abc',
    );
    expect(resolved.meta.title).toBe('Cached Title');
  });

  it('loading window: blank live title does not clobber the snapshot', () => {
    const resolved = resolveTab(
      fixtureRoutes,
      tab('/agent/abc', { title: 'Cached Title' }),
      true,
      t,
      { title: '' },
      '/agent/abc',
    );
    expect(resolved.meta.title).toBe('Cached Title');
  });

  it('falls back to the static titleKey when no snapshot exists', () => {
    const resolved = resolveTab(fixtureRoutes, tab('/agent/abc'), false, t);
    expect(resolved.meta.title).toBe('navigation.chat');
  });

  it('uses Home as the Electron tab title for the Home route', () => {
    const resolved = resolveTab(fixtureRoutes, tab('/'), false, t);
    expect(resolved.meta.title).toBe('navigation.home');
  });

  it('uses the generic fallback when neither snapshot nor static meta exists', () => {
    const resolved = resolveTab(fixtureRoutes, tab('/group/g1'), false, t);
    expect(resolved.meta.title).toBe('navigation.lobehub');
    expect(resolved.meta.icon).toBe(Circle);
  });

  it('icon always comes from static route meta, never the snapshot', () => {
    const resolved = resolveTab(fixtureRoutes, tab('/agent/abc', { title: 'Cached' }), false, t);
    expect(resolved.meta.icon).toBe(MessageSquare);
  });

  it('does not drop a tab with undefined store data (cold start)', () => {
    const resolved = resolveTab(fixtureRoutes, tab('/agent/abc'), true, t, undefined);
    expect(resolved.tab.url).toBe('/agent/abc');
    expect(resolved.meta.title).toBe('navigation.chat');
  });
});
