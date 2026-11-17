import { afterEach, describe, expect, it } from 'vitest';

import {
  closedOwnersBetween,
  createBackOriginRecorder,
  getBackOrigin,
  historyDeltaTo,
  pruneBackOwners,
  recordBackLocation,
  resetBackOrigins,
  resolveBackScope,
} from './index';

const walk = (...paths: string[]) => {
  for (const path of paths) recordBackLocation('main', path);
};

afterEach(() => {
  resetBackOrigins();
});

describe('resolveBackScope', () => {
  it('scopes agent and group pages by id', () => {
    expect(resolveBackScope('/agent/agt_1')).toBe('agent:agt_1');
    expect(resolveBackScope('/agent/agt_1/tpc_2?x=1')).toBe('agent:agt_1');
    expect(resolveBackScope('/group/grp_1/settings')).toBe('group:grp_1');
  });

  it('strips a workspace slug prefix', () => {
    expect(resolveBackScope('/lobehub/agent/agt_1')).toBe('agent:agt_1');
    expect(resolveBackScope('/lobehub/group/grp_1')).toBe('group:grp_1');
  });

  it('leaves every other page unscoped', () => {
    expect(resolveBackScope('/')).toBeNull();
    expect(resolveBackScope('/agents')).toBeNull();
    expect(resolveBackScope('/agent')).toBeNull();
    expect(resolveBackScope('/lobehub/tasks')).toBeNull();
    expect(resolveBackScope('/lobehub')).toBeNull();
  });
});

describe('recordBackLocation', () => {
  it('remembers the page an agent was opened from', () => {
    walk('/tasks', '/agent/agt_1');
    expect(getBackOrigin('main', '/agent/agt_1')).toBe('/tasks');
  });

  it('keeps the origin while moving inside the agent', () => {
    walk('/agents', '/agent/agt_1', '/agent/agt_1/tpc_1', '/agent/agt_1/profile');
    expect(getBackOrigin('main', '/agent/agt_1/profile')).toBe('/agents');
  });

  it('keeps the query string of the origin', () => {
    walk('/resource?mode=list', '/lobehub/group/grp_1');
    expect(getBackOrigin('main', '/lobehub/group/grp_1')).toBe('/resource?mode=list');
  });

  it('steps back one level at a time through nested entries', () => {
    walk('/tasks', '/agent/agt_1', '/agent/agt_1/tpc_1', '/group/grp_1');
    // group → the agent (at the topic it was left on) → the page it was opened from
    expect(getBackOrigin('main', '/group/grp_1')).toBe('/agent/agt_1/tpc_1');
    walk('/agent/agt_1/tpc_1');
    expect(getBackOrigin('main', '/agent/agt_1/tpc_1')).toBe('/tasks');
  });

  it('cuts the trail when re-entering an entry instead of ping-ponging', () => {
    walk('/project/p1', '/agent/agt_1', '/agent/agt_2', '/agent/agt_1');
    expect(getBackOrigin('main', '/agent/agt_1')).toBe('/project/p1');
    expect(getBackOrigin('main', '/agent/agt_2')).toBeUndefined();
  });

  it('returns to the same origin after repeated enter / back rounds', () => {
    for (let round = 0; round < 3; round++) {
      walk('/tasks', '/agent/agt_1', '/group/grp_1');
      expect(getBackOrigin('main', '/group/grp_1')).toBe('/agent/agt_1');
      walk('/agent/agt_1');
      expect(getBackOrigin('main', '/agent/agt_1')).toBe('/tasks');
    }
  });

  it('has no origin when the agent is the first page', () => {
    walk('/agent/agt_1');
    expect(getBackOrigin('main', '/agent/agt_1')).toBeUndefined();
  });

  it('replaces a stale origin on the next entry', () => {
    walk('/tasks', '/agent/agt_1', '/memory', '/agent/agt_1');
    expect(getBackOrigin('main', '/agent/agt_1')).toBe('/memory');
  });

  it('keeps the literal personal origin when an escaped link hops into a workspace', () => {
    walk('/tasks', '/acme/agent/agt_2');
    // Not rebased onto `/acme/tasks`: the back button navigates to it as-is.
    expect(getBackOrigin('main', '/acme/agent/agt_2')).toBe('/tasks');
  });

  it('returns nothing for unscoped pages', () => {
    walk('/tasks', '/agent/agt_1');
    expect(getBackOrigin('main', '/tasks')).toBeUndefined();
  });

  it('caps the trail length', () => {
    walk('/tasks', ...Array.from({ length: 80 }, (_, i) => `/agent/agt_${i}`));
    expect(getBackOrigin('main', '/agent/agt_79')).toBe('/agent/agt_78');
  });
});

describe('createBackOriginRecorder', () => {
  it('records navigations within one owner', () => {
    const record = createBackOriginRecorder();
    record('tab-1', '/tasks');
    record('tab-1', '/agent/agt_1');
    expect(getBackOrigin('tab-1', '/agent/agt_1')).toBe('/tasks');
  });

  it('does not treat switching to another tab as a navigation', () => {
    const record = createBackOriginRecorder();
    record('tab-1', '/projects');
    record('tab-1', '/agent/agt_1');
    record('tab-2', '/tasks');
    record('tab-1', '/agent/agt_1');
    expect(getBackOrigin('tab-1', '/agent/agt_1')).toBe('/projects');
  });

  it('keeps a separate origin for the same agent open in two tabs', () => {
    const record = createBackOriginRecorder();
    record('tab-1', '/projects');
    record('tab-1', '/agent/agt_1');
    record('tab-2', '/tasks');
    record('tab-2', '/agent/agt_1');
    expect(getBackOrigin('tab-1', '/agent/agt_1')).toBe('/projects');
    expect(getBackOrigin('tab-2', '/agent/agt_1')).toBe('/tasks');
  });

  it('gives an agent first seen in a fresh tab no origin', () => {
    const record = createBackOriginRecorder();
    record('tab-1', '/tasks');
    record('tab-2', '/agent/agt_1');
    record('tab-1', '/tasks');
    record('tab-2', '/agent/agt_1');
    expect(getBackOrigin('tab-2', '/agent/agt_1')).toBeUndefined();
  });

  it('gives a tab duplicated from another one the source origin', () => {
    const record = createBackOriginRecorder();
    record('tab-1', '/projects');
    record('tab-1', '/agent/agt_1');
    record('tab-2', '/agent/agt_1');
    expect(getBackOrigin('tab-2', '/agent/agt_1')).toBe('/projects');
  });

  it('restores an agent origin when browser Back revisits its history entry', () => {
    const record = createBackOriginRecorder();
    record('main', '/tasks', 0, 'tasks');
    record('main', '/agent/agt_1', 1, 'agent');
    record('main', '/settings', 2, 'settings');
    record('main', '/agent/agt_1', 1, 'agent');

    expect(getBackOrigin('main', '/agent/agt_1')).toBe('/tasks');
  });

  it('restores the origin when browser Forward skips over it', () => {
    const record = createBackOriginRecorder();
    record('main', '/tasks', 0, 'tasks');
    record('main', '/settings', 1, 'settings');
    record('main', '/group/grp_1', 2, 'group');
    record('main', '/tasks', 0, 'tasks');
    record('main', '/group/grp_1', 2, 'group');

    expect(getBackOrigin('main', '/group/grp_1')).toBe('/settings');
  });

  it('records a fresh origin for a new visit that reuses a history index', () => {
    const record = createBackOriginRecorder();
    record('main', '/tasks', 0, 'tasks');
    record('main', '/agent/agt_1', 1, 'first-agent');
    record('main', '/tasks', 0, 'tasks');
    record('main', '/settings', 0, 'settings');
    record('main', '/agent/agt_1', 1, 'second-agent');

    expect(getBackOrigin('main', '/agent/agt_1')).toBe('/settings');
  });

  it('keeps the hash of the origin page', () => {
    const record = createBackOriginRecorder();
    record('main', '/page/docs_1#notes');
    record('main', '/agent/agt_1');
    expect(getBackOrigin('main', '/agent/agt_1')).toBe('/page/docs_1#notes');
  });
});

describe('history walk-back', () => {
  it('steps back over the entries opened inside the agent', () => {
    const record = createBackOriginRecorder();
    record('main', '/tasks', 3, 'tasks');
    record('main', '/agent/agt_1', 4, 'agent');
    record('main', '/agent/agt_1/tpc_1', 5, 'topic');
    const origin = { historyIndex: 3, location: '/tasks', locationKey: 'tasks' };
    expect(historyDeltaTo(origin, 5)).toBe(-2);
  });

  it('falls back to the saved URL when its browser entry was replaced', () => {
    const record = createBackOriginRecorder();
    const origin = { historyIndex: 1, location: '/agent/agt_1/tpc_1', locationKey: 'topic-1' };
    const group = '/group/grp_1';

    record('main', '/tasks', 0, 'tasks');
    record('main', origin.location, 1, 'topic-1');
    record('main', group, 2, 'group');
    expect(historyDeltaTo(origin, 2)).toBe(-1);

    record('main', origin.location, 1, 'topic-1');
    record('main', '/agent/agt_1/tpc_2', 1, 'topic-2');
    record('main', group, 2, 'group');

    expect(getBackOrigin('main', group)).toBe(origin.location);
    expect(historyDeltaTo(origin, 2)).toBeUndefined();
  });

  it('falls back to pushing when the origin is not an earlier history entry', () => {
    const record = createBackOriginRecorder();
    record('main', '/tasks', 4, 'tasks');
    const origin = { historyIndex: 4, location: '/tasks', locationKey: 'tasks' };
    expect(historyDeltaTo(origin, 4)).toBeUndefined();
    expect(historyDeltaTo(origin, 3)).toBeUndefined();
    expect(historyDeltaTo(origin, undefined)).toBeUndefined();
    expect(historyDeltaTo({ location: '/tasks' }, 5)).toBeUndefined();
  });

  it('records a revisit of the same location at a new history index', () => {
    recordBackLocation('main', '/tasks', 1);
    recordBackLocation('main', '/tasks', 3);
    recordBackLocation('main', '/agent/agt_1', 4);
    expect(getBackOrigin('main', '/agent/agt_1')).toBe('/tasks');
  });
});

describe('pruneBackOwners', () => {
  it('drops the trails of closed tabs and keeps open ones however many there are', () => {
    const record = createBackOriginRecorder();
    for (let tab = 0; tab < 30; tab++) {
      record(`tab-${tab}`, `/page/${tab}`);
      record(`tab-${tab}`, '/agent/agt_1');
    }
    pruneBackOwners(['tab-0']);

    expect(getBackOrigin('tab-0', '/agent/agt_1')).toBeUndefined();
    expect(getBackOrigin('tab-1', '/agent/agt_1')).toBe('/page/1');
    expect(getBackOrigin('tab-29', '/agent/agt_1')).toBe('/page/29');
  });

  it('always keeps the main owner', () => {
    walk('/tasks', '/agent/agt_1');
    pruneBackOwners(['main']);
    expect(getBackOrigin('main', '/agent/agt_1')).toBe('/tasks');
  });
});

describe('closedOwnersBetween', () => {
  it('reports tabs that left the list within one scope', () => {
    expect(
      closedOwnersBetween(
        { ids: ['tab-1', 'tab-2'], scope: 'personal' },
        { ids: ['tab-2'], scope: 'personal' },
      ),
    ).toEqual(['tab-1']);
  });

  it('closes nothing when the scope switches', () => {
    expect(
      closedOwnersBetween(
        { ids: ['tab-1', 'tab-2'], scope: 'personal' },
        { ids: ['tab-3'], scope: 'workspace:acme' },
      ),
    ).toEqual([]);
    expect(closedOwnersBetween(null, { ids: ['tab-3'], scope: 'personal' })).toEqual([]);
  });
});
