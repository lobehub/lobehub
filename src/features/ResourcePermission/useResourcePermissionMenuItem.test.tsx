/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useResourcePermissionMenuItem } from './useResourcePermissionMenuItem';

const permissionMock = vi.hoisted(() => ({
  data: {
    accessLevel: 'view',
    canManage: false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => children,
  Icon: () => null,
}));

vi.mock('./useResourcePermission', () => ({
  useResourcePermission: () => ({
    data: permissionMock.data,
    error: undefined,
    isLoading: false,
    setAccessLevel: vi.fn(),
    updating: false,
  }),
}));

describe('useResourcePermissionMenuItem', () => {
  beforeEach(() => {
    permissionMock.data = {
      accessLevel: 'view',
      canManage: false,
    };
  });

  it('keeps non-manageable permissions hidden by default', () => {
    const { result } = renderHook(() => useResourcePermissionMenuItem('document', 'doc-1'));

    expect(result.current).toBeNull();
  });

  it('shows the current permission as a disabled overflow item when requested', () => {
    const { result } = renderHook(() =>
      useResourcePermissionMenuItem('document', 'doc-1', { showReadOnly: true }),
    );

    expect(result.current).toMatchObject({
      disabled: true,
      key: 'member-permissions',
      label: 'permission.generalAccess.trigger',
    });
  });

  it('offers only edit and use access for manageable agents', () => {
    permissionMock.data = {
      accessLevel: 'use',
      canManage: true,
    };

    const { result } = renderHook(() => useResourcePermissionMenuItem('agent', 'agent-1'));
    const item = result.current as { children: { key: string }[] };

    expect(item.children.map(({ key }) => key)).toEqual([
      'member-permission-edit',
      'member-permission-use',
    ]);
  });

  it('keeps edit and view access for manageable documents', () => {
    permissionMock.data = {
      accessLevel: 'view',
      canManage: true,
    };

    const { result } = renderHook(() => useResourcePermissionMenuItem('document', 'doc-1'));
    const item = result.current as { children: { key: string }[] };

    expect(item.children.map(({ key }) => key)).toEqual([
      'member-permission-edit',
      'member-permission-view',
    ]);
  });
});
