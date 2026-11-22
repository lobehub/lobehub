import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCreateVisibility, useCreateVisibility } from './useCreateVisibility';

const mocks = vi.hoisted(() => ({
  permission: { allowed: true, reason: undefined as string | undefined },
  workspaceId: 'ws-1' as string | undefined,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.workspaceId,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => mocks.permission,
}));

describe('resolveCreateVisibility', () => {
  it('starts private in a workspace when the caller gives no context', () => {
    expect(resolveCreateVisibility({ inWorkspace: true })).toEqual({
      initial: 'private',
      locked: false,
      show: true,
    });
  });

  it('keeps the list context as an editable starting value', () => {
    expect(resolveCreateVisibility({ inWorkspace: true, visibility: 'public' })).toEqual({
      initial: 'public',
      locked: false,
      show: true,
    });
  });

  it('locks to the folder visibility when creating inside a folder', () => {
    expect(
      resolveCreateVisibility({ groupId: 'sg-1', inWorkspace: true, visibility: 'public' }),
    ).toEqual({ initial: 'public', locked: true, show: true });
  });

  it('hides the field for a folder of unknown visibility so the server inherits it', () => {
    expect(resolveCreateVisibility({ groupId: 'sg-1', inWorkspace: true })).toEqual({
      initial: undefined,
      locked: true,
      show: false,
    });
  });

  it('hides the field outside a workspace and passes the caller value through', () => {
    expect(resolveCreateVisibility({ inWorkspace: false })).toEqual({
      initial: undefined,
      locked: false,
      show: false,
    });
  });
});

describe('useCreateVisibility', () => {
  beforeEach(() => {
    mocks.permission = { allowed: true, reason: undefined };
    mocks.workspaceId = 'ws-1';
  });

  it('lets the user switch the default to workspace', () => {
    const { result } = renderHook(() => useCreateVisibility());
    expect(result.current.value).toBe('private');

    act(() => result.current.setValue('public'));

    expect(result.current.value).toBe('public');
  });

  it('falls back to private when the user cannot create workspace content', () => {
    mocks.permission = { allowed: false, reason: 'Members only' };

    const { result } = renderHook(() => useCreateVisibility({ visibility: 'public' }));

    expect(result.current.value).toBe('private');
    expect(result.current.canPublish).toBe(false);
    expect(result.current.publishBlockedReason).toBe('Members only');
  });

  it('does not remember the previous choice across dialogs', () => {
    const first = renderHook(() => useCreateVisibility());
    act(() => first.result.current.setValue('public'));
    first.unmount();

    const second = renderHook(() => useCreateVisibility());

    expect(second.result.current.value).toBe('private');
  });
});
