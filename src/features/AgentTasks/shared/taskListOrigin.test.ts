import { describe, expect, it } from 'vitest';

import { resolveTaskListCrumbTarget, resolveTaskListRootCrumb } from './taskListOrigin';

describe('resolveTaskListCrumbTarget', () => {
  it('returns the origin, filters included, when it is the crumb list', () => {
    expect(resolveTaskListCrumbTarget('/tasks?collection=mine', '/tasks', null)).toBe(
      '/tasks?collection=mine',
    );
  });

  it('returns the bare list when the origin is another list', () => {
    expect(resolveTaskListCrumbTarget('/agent/a1/tasks?collection=mine', '/tasks', null)).toBe(
      '/tasks',
    );
    expect(resolveTaskListCrumbTarget('/tasks?collection=mine', '/agent/a1/tasks', null)).toBe(
      '/agent/a1/tasks',
    );
  });

  it('returns the bare list without an origin', () => {
    expect(resolveTaskListCrumbTarget(undefined, '/tasks', null)).toBe('/tasks');
  });

  it('matches the workspace-prefixed list path', () => {
    expect(resolveTaskListCrumbTarget('/acme/tasks?collection=mine', '/tasks', 'acme')).toBe(
      '/acme/tasks?collection=mine',
    );
    expect(
      resolveTaskListCrumbTarget('/acme/agent/a1/tasks?scope=created', '/agent/a1/tasks', 'acme'),
    ).toBe('/acme/agent/a1/tasks?scope=created');
  });

  it('ignores an origin from another workspace', () => {
    expect(resolveTaskListCrumbTarget('/other/tasks?collection=mine', '/tasks', 'acme')).toBe(
      '/tasks',
    );
    expect(resolveTaskListCrumbTarget('/acme/tasks?collection=mine', '/tasks', null)).toBe(
      '/tasks',
    );
  });

  it('does not treat a longer path as the list', () => {
    expect(resolveTaskListCrumbTarget('/tasks/archive?x=1', '/tasks', null)).toBe('/tasks');
  });

  it('never leads off the app, whatever the history state holds', () => {
    for (const origin of [
      '//evil.example/tasks?collection=mine',
      '/\\evil.example/tasks',
      'https://evil.example/tasks',
      'javascript:alert(1)//tasks',
      '/tasks/../\\evil.example/tasks',
    ]) {
      expect(resolveTaskListCrumbTarget(origin, '/tasks', null)).toBe('/tasks');
    }
  });

  it('keeps the hash along with the filters', () => {
    expect(resolveTaskListCrumbTarget('/tasks?collection=mine#top', '/tasks', null)).toBe(
      '/tasks?collection=mine#top',
    );
  });
});

describe('resolveTaskListRootCrumb', () => {
  it('reads the tab from the carried origin of the global list', () => {
    expect(
      resolveTaskListRootCrumb('/acme/tasks?scope=created', 'acme', { allowMine: true }),
    ).toEqual({ collection: 'mine', escape: true, to: '/acme/tasks?scope=created' });
  });

  it('falls back to "All tasks" for an origin that is not the global list', () => {
    for (const origin of [undefined, '/acme/agent/a1/tasks', '//evil.example/acme/tasks']) {
      expect(resolveTaskListRootCrumb(origin, 'acme', { allowMine: true })).toEqual({
        collection: 'tasks',
        escape: false,
        to: '/tasks?collection=all',
      });
    }
  });

  it('keeps the bare list as "All tasks" where there is no "My tasks" tab', () => {
    expect(resolveTaskListRootCrumb(undefined, null, { allowMine: false })).toEqual({
      collection: 'tasks',
      escape: false,
      to: '/tasks',
    });
    expect(resolveTaskListRootCrumb('/tasks', null, { allowMine: false })).toMatchObject({
      collection: 'tasks',
      to: '/tasks',
    });
  });
});
