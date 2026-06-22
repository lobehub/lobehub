import { MessageSquare } from 'lucide-react';
import { type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';

import { mergeSearchParams } from '@/features/RouteMeta/params';
import { type RouteMeta } from '@/spa/router/routeMeta';

import {
  FALLBACK_ICON,
  guardedMergeCache,
  matchRouteMeta,
  pickMeaningful,
} from './resolveRouteMeta';

const agentMeta: RouteMeta = { icon: MessageSquare, titleKey: 'navigation.chat' };

const fixtureRoutes: RouteObject[] = [
  {
    children: [{ handle: { meta: agentMeta }, path: 'agent/:aid' }, { path: 'group/:gid' }],
    path: '/',
  },
];

describe('matchRouteMeta', () => {
  it('returns the deepest static meta for a matched route', () => {
    const result = matchRouteMeta(fixtureRoutes, '/agent/abc');
    expect(result.static.icon).toBe(MessageSquare);
    expect(result.static.titleKey).toBe('navigation.chat');
    expect(result.params.aid).toBe('abc');
    expect(result.meta).toBe(agentMeta);
  });

  it('returns empty static meta when no handle.meta exists', () => {
    const result = matchRouteMeta(fixtureRoutes, '/group/g1');
    expect(result.static.icon).toBeUndefined();
    expect(result.static.titleKey).toBeUndefined();
    expect(result.meta).toBeUndefined();
  });

  it('returns empty static meta when no route matches', () => {
    const result = matchRouteMeta(fixtureRoutes, '/nonexistent/path');
    expect(result.static).toEqual({});
  });

  it('merges search params into route params', () => {
    const result = matchRouteMeta(fixtureRoutes, '/agent/abc?topic=tpc_1');
    expect(result.params.aid).toBe('abc');
    expect(result.params.topic).toBe('tpc_1');
  });
});

describe('mergeSearchParams', () => {
  it('keeps path params when search params use the same key', () => {
    expect(mergeSearchParams({ aid: 'path-agent' }, '?aid=query-agent&topic=t1')).toEqual({
      aid: 'path-agent',
      topic: 't1',
    });
  });
});

describe('guardedMergeCache', () => {
  it('writes only defined non-empty string fields', () => {
    const merged = guardedMergeCache(
      { avatar: 'a.png', title: 'Old' },
      { avatar: '', title: undefined },
    );
    expect(merged).toEqual({ avatar: 'a.png', title: 'Old' });
  });

  it('improves the cache with meaningful values', () => {
    const merged = guardedMergeCache({ title: 'Old' }, { avatar: 'a.png', title: 'New' });
    expect(merged).toEqual({ avatar: 'a.png', title: 'New' });
  });

  it('returns prev when next is undefined', () => {
    const prev = { title: 'Old' };
    expect(guardedMergeCache(prev, undefined)).toBe(prev);
  });

  it('returns undefined when nothing meaningful exists', () => {
    expect(guardedMergeCache(undefined, { title: '' })).toBeUndefined();
  });
});

describe('pickMeaningful', () => {
  it('returns the value when non-empty', () => {
    expect(pickMeaningful('x')).toBe('x');
  });

  it('returns undefined for empty string', () => {
    expect(pickMeaningful('')).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(pickMeaningful(undefined)).toBeUndefined();
  });
});

describe('FALLBACK_ICON', () => {
  it('is exported as the generic fallback', () => {
    expect(FALLBACK_ICON).toBeDefined();
  });
});
