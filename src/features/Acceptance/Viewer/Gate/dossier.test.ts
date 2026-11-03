import type { GoalReleaseGateUnit } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { latestRound, unitArtifacts } from './dossier';

describe('latestRound', () => {
  it('reads the newest round', () => {
    expect(latestRound({ rounds: [{ id: 'r1' }, { id: 'r2' }] })).toEqual({ id: 'r2' });
  });

  it('has none when the bundle carries no rounds', () => {
    expect(latestRound({})).toBeUndefined();
    expect(latestRound(undefined)).toBeUndefined();
  });
});

describe('unitArtifacts', () => {
  it('is empty for a unit frozen before units carried deliverables', () => {
    const unit = { nodeId: 'node_a', runs: 1, title: 'a', tokens: 1 } as GoalReleaseGateUnit;
    expect(unitArtifacts(unit)).toEqual([]);
  });
});
