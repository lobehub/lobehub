import { Circle, MessageSquare } from 'lucide-react';
import { type RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type RouteMeta } from '@/spa/router/routeMeta';

import { resolveTab } from './hooks/useResolvedTabs';
import { type TabItem } from './types';

const agentMeta: RouteMeta = { icon: MessageSquare, titleKey: 'navigation.chat' };

const fixtureRoutes: RouteObject[] = [
  {
    children: [{ handle: { meta: agentMeta }, path: 'agent/:aid' }, { path: 'group/:gid' }],
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
