import { describe, expect, it } from 'vitest';

import { getStagedBranchState } from '../stagedBranchState';

describe('getStagedBranchState', () => {
  it('holds a hydrated branch read-only until this session confirms it', () => {
    expect(getStagedBranchState({ branch: 'main', detached: false }, false)).toBe('confirming');
  });

  it('lets a confirmed branch switch', () => {
    expect(getStagedBranchState({ branch: 'main', detached: false }, true)).toBe('switchable');
  });

  it('shows a detached head without a switcher', () => {
    expect(getStagedBranchState({ branch: 'abc1234', detached: true }, true)).toBe('detached');
  });

  it('hides when the directory is not a repo or not read yet', () => {
    expect(getStagedBranchState({}, true)).toBe('hidden');
    expect(getStagedBranchState(undefined, false)).toBe('hidden');
  });
});
