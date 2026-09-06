import { describe, expect, it } from 'vitest';

import { trashKeys } from '@/store/trash/keys';

import { getWorkspaceTrashCacheScope } from './cacheScope';

describe('workspace trash cache scope', () => {
  it('keeps personal and workspace caches distinct across workspace switches', () => {
    const workspaceA = getWorkspaceTrashCacheScope('alpha');
    const workspaceB = getWorkspaceTrashCacheScope('beta');

    expect(workspaceA).toBe('workspace:alpha');
    expect(workspaceB).toBe('workspace:beta');
    expect(trashKeys.list(null)).not.toEqual(trashKeys.list(workspaceA));
    expect(trashKeys.list(workspaceA)).not.toEqual(trashKeys.list(workspaceB));
    expect(trashKeys.countByType(workspaceA)).not.toEqual(trashKeys.countByType(workspaceB));
  });
});
