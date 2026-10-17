import { describe, expect, it, vi } from 'vitest';

import {
  canCopyInstance,
  copyBlockReason,
  copyEntryTitle,
  deleteEntry,
  recheckCopySource,
} from './instanceActions';

const idle = { buildId: null, id: 'inst-1', inUse: false, status: 'ready' };

describe('copyBlockReason', () => {
  it('allows a copy of an idle, built copy', () => {
    expect(copyBlockReason(idle, false)).toBeUndefined();
  });

  it('blocks a copy a run is holding — the server answers INSTANCE_IN_USE', () => {
    expect(copyBlockReason({ ...idle, inUse: true }, false)).toBe('inUse');
  });

  it('does not read an unanswered lease store as free', () => {
    expect(copyBlockReason(idle, true)).toBe('occupancyUnknown');
  });

  it('blocks a copy whose build is replacing its folder', () => {
    expect(copyBlockReason({ ...idle, buildId: 'b1', status: 'pending' }, false)).toBe('building');
  });

  it('allows a never-built copy, which nothing is writing to', () => {
    expect(copyBlockReason({ ...idle, status: 'pending' }, false)).toBeUndefined();
  });
});

describe('copyEntryTitle', () => {
  it('says why the entry is greyed out', () => {
    expect(copyEntryTitle('inUse')).toBe('environments.instances.copyInUse');
    expect(copyEntryTitle('occupancyUnknown')).toBe('environments.instances.copyOccupancyUnknown');
    expect(copyEntryTitle('building')).toBe('environments.instances.copyBuilding');
  });

  it('names the action when it is available', () => {
    expect(copyEntryTitle(undefined)).toBe('environments.instances.copy');
  });
});

describe('recheckCopySource', () => {
  it('lets the dialog open when the fresh read still finds the source idle', async () => {
    const refetch = vi.fn().mockResolvedValue({ instances: [idle], occupancyUnavailable: false });

    await expect(recheckCopySource('inst-1', refetch)).resolves.toBeUndefined();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('stops the copy when a run took the source since the list was drawn', async () => {
    const refetch = vi
      .fn()
      .mockResolvedValue({ instances: [{ ...idle, inUse: true }], occupancyUnavailable: false });

    await expect(recheckCopySource('inst-1', refetch)).resolves.toBe('inUse');
  });

  it('stops the copy when the fresh read cannot tell who holds it', async () => {
    const refetch = vi.fn().mockResolvedValue({ instances: [idle], occupancyUnavailable: true });

    await expect(recheckCopySource('inst-1', refetch)).resolves.toBe('occupancyUnknown');
  });

  it('leaves a failed re-read to the server, which checks again', async () => {
    const refetch = vi.fn().mockRejectedValue(new Error('network'));

    await expect(recheckCopySource('inst-1', refetch)).resolves.toBeUndefined();
  });
});

describe('deleteEntry', () => {
  it('offers no delete on the default copy among several, even to its creator', () => {
    expect(deleteEntry({ isDefault: true }, { editable: true, single: false })).toBeUndefined();
  });

  it('offers to delete a copy beside the default', () => {
    expect(deleteEntry({ isDefault: false }, { editable: true, single: false })).toBe('instance');
  });

  it("makes the only copy's delete entry delete the environment", () => {
    expect(deleteEntry({ isDefault: true }, { editable: true, single: true })).toBe('environment');
  });

  it('offers no delete to anyone but the creator', () => {
    expect(deleteEntry({ isDefault: false }, { editable: false, single: false })).toBeUndefined();
    expect(deleteEntry({ isDefault: true }, { editable: false, single: true })).toBeUndefined();
  });
});

describe('canCopyInstance', () => {
  it('shows the copy entry to the environment creator only', () => {
    expect(canCopyInstance(true)).toBe(true);
    expect(canCopyInstance(false)).toBe(false);
  });
});
