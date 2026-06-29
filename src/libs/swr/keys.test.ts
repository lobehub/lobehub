import { describe, expect, it } from 'vitest';

import { recentKeys } from './keys';

describe('recentKeys', () => {
  it('keys the Home recent list by identity cache scope', () => {
    expect(recentKeys.list(true, 10, 'user-1:workspace-1')).toEqual([
      'recent:list',
      true,
      10,
      'user-1:workspace-1',
    ]);
  });

  it('keeps users isolated in the same workspace', () => {
    expect(recentKeys.list(true, 10, 'user-1:workspace-1')).not.toEqual(
      recentKeys.list(true, 10, 'user-2:workspace-1'),
    );
  });

  it('keeps workspaces isolated for the same user', () => {
    expect(recentKeys.allDrawer(true, 'user-1:workspace-1')).not.toEqual(
      recentKeys.allDrawer(true, 'user-1:workspace-2'),
    );
  });
});
