import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskArchiveGate } from './useTaskArchiveGate';

const mocks = vi.hoisted(() => ({
  canEdit: true,
  manageable: true,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEdit }),
}));

// The gate must not depend on who created the task; this mock fails the
// creator-agnostic case below if a creator check is wired back in.
vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageableChecker: () => () => mocks.manageable,
}));

const check = (options?: { archiveBlocked?: boolean }) =>
  renderHook(() => useTaskArchiveGate()).result.current(options);

describe('useTaskArchiveGate', () => {
  beforeEach(() => {
    mocks.canEdit = true;
    mocks.manageable = true;
  });

  it('lets any member who can edit tasks archive, whoever created the task', () => {
    mocks.manageable = false;
    expect(check()).toEqual({ allowed: true });
  });

  it('explains that live work must stop before archiving, but not before restoring', () => {
    expect(check({ archiveBlocked: true })).toEqual({
      allowed: false,
      reasonKey: 'taskList.contextMenu.archiveBlocked',
    });
    expect(check({ archiveBlocked: false })).toEqual({ allowed: true });
  });

  it('puts the missing edit permission ahead of live work', () => {
    mocks.canEdit = false;
    expect(check({ archiveBlocked: true })).toEqual({
      allowed: false,
      reasonKey: 'taskList.contextMenu.archiveDenied.noEditPermission',
    });
  });
});
