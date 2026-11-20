import { describe, expect, it } from 'vitest';

import { parseSwarmLanePath, swarmLaneDirectory, swarmLaneKeys } from './goalSwarm';

describe('goal swarm lane paths', () => {
  it('names lanes A, B, C… and places each under .lanes', () => {
    expect(swarmLaneKeys(3)).toEqual(['A', 'B', 'C']);
    expect(swarmLaneDirectory('/work/k12/', 'B')).toBe('/work/k12/.lanes/B');
  });

  it('reads the workspace and lane back from a lane directory or a path inside it', () => {
    expect(parseSwarmLanePath('/work/k12/.lanes/B')).toEqual({ key: 'B', workspace: '/work/k12' });
    expect(parseSwarmLanePath('/work/k12/.lanes/B/models/')).toEqual({
      key: 'B',
      workspace: '/work/k12',
    });
  });

  it('is not fooled by a path that only resembles a lane', () => {
    expect(parseSwarmLanePath('/work/k12')).toBeUndefined();
    expect(parseSwarmLanePath('/work/k12/.lanes')).toBeUndefined();
    expect(parseSwarmLanePath('/work/k12/.lanes/_before_promote')).toBeUndefined();
  });
});
