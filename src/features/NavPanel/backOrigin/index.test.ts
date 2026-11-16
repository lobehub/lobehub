import { afterEach, describe, expect, it } from 'vitest';

import {
  createBackOriginRecorder,
  getBackOrigin,
  recordBackOrigin,
  resetBackOrigins,
  resolveBackScope,
} from './index';

const walk = (...paths: string[]) => {
  let previous: string | null = null;
  for (const path of paths) {
    recordBackOrigin(previous, path);
    previous = path;
  }
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

describe('recordBackOrigin', () => {
  it('remembers the page an agent was opened from', () => {
    walk('/tasks', '/agent/agt_1');
    expect(getBackOrigin('/agent/agt_1')).toBe('/tasks');
  });

  it('keeps the origin while moving inside the agent', () => {
    walk('/agents', '/agent/agt_1', '/agent/agt_1/tpc_1', '/agent/agt_1/profile');
    expect(getBackOrigin('/agent/agt_1/profile')).toBe('/agents');
  });

  it('keeps the query string of the origin', () => {
    walk('/resource?mode=list', '/lobehub/group/grp_1');
    expect(getBackOrigin('/lobehub/group/grp_1')).toBe('/resource?mode=list');
  });

  it('inherits the origin when hopping between agents instead of ping-ponging', () => {
    walk('/project/p1', '/agent/agt_1', '/agent/agt_2', '/agent/agt_1');
    expect(getBackOrigin('/agent/agt_2')).toBe('/project/p1');
    expect(getBackOrigin('/agent/agt_1')).toBe('/project/p1');
  });

  it('has no origin when the agent is the first page or was reached from an unknown one', () => {
    walk('/agent/agt_1');
    expect(getBackOrigin('/agent/agt_1')).toBeUndefined();

    walk('/agent/agt_1', '/agent/agt_2');
    expect(getBackOrigin('/agent/agt_2')).toBeUndefined();
  });

  it('replaces a stale origin on the next entry', () => {
    walk('/tasks', '/agent/agt_1', '/memory', '/agent/agt_1');
    expect(getBackOrigin('/agent/agt_1')).toBe('/memory');
  });

  it('returns nothing for unscoped pages', () => {
    walk('/tasks', '/agent/agt_1');
    expect(getBackOrigin('/tasks')).toBeUndefined();
  });
});

describe('createBackOriginRecorder', () => {
  it('records navigations within one owner', () => {
    const record = createBackOriginRecorder();
    record('tab-1', '/tasks');
    record('tab-1', '/agent/agt_1');
    expect(getBackOrigin('/agent/agt_1')).toBe('/tasks');
  });

  it('does not treat switching to another tab as a navigation', () => {
    const record = createBackOriginRecorder();
    record('tab-1', '/projects');
    record('tab-1', '/agent/agt_1');
    record('tab-2', '/tasks');
    record('tab-1', '/agent/agt_1');
    expect(getBackOrigin('/agent/agt_1')).toBe('/projects');
  });

  it('gives an agent first seen in a fresh tab no origin', () => {
    const record = createBackOriginRecorder();
    record('tab-1', '/tasks');
    record('tab-2', '/agent/agt_1');
    record('tab-1', '/tasks');
    record('tab-2', '/agent/agt_1');
    expect(getBackOrigin('/agent/agt_1')).toBeUndefined();
  });
});
