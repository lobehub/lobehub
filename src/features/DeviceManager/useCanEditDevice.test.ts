/**
 * @vitest-environment happy-dom
 */
import type { DeviceEnroller, DeviceListItem, DeviceScope } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanEditDevice } from './useCanEditDevice';

// Mocks live inside `hoisted` so the `vi.mock` factories below can reach
// them — vi.mock is hoisted above imports, and only `vi.hoisted` survives that.
const mocks = vi.hoisted(() => {
  const userState = { userId: 'current-user-id' as string | undefined };
  const isOwner = { current: false };
  return { isOwner, userState };
});

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => mocks.isOwner.current,
}));

vi.mock('@/store/user', () => ({
  useUserStore: <T>(selector: (state: typeof mocks.userState) => T): T => selector(mocks.userState),
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: (state: typeof mocks.userState) => state.userId,
  },
}));

const buildEnroller = (userId: string): DeviceEnroller => ({
  avatar: null,
  fullName: null,
  userId,
  username: null,
});

const buildDevice = (overrides: {
  enroller?: DeviceEnroller | null;
  scope: DeviceScope;
}): DeviceListItem => ({
  channels: [],
  defaultCwd: null,
  deviceId: 'dev-1',
  enroller: overrides.enroller ?? null,
  friendlyName: null,
  hostname: null,
  identitySource: 'machine-id',
  lastSeen: new Date(0).toISOString(),
  online: false,
  platform: null,
  registered: true,
  scope: overrides.scope,
  workingDirs: [],
});

describe('useCanEditDevice', () => {
  beforeEach(() => {
    mocks.userState.userId = 'current-user-id';
    mocks.isOwner.current = false;
  });

  describe('personal scope', () => {
    it('is always editable, even for ghost rows', () => {
      const { result } = renderHook(() => useCanEditDevice());
      expect(result.current(buildDevice({ scope: 'personal' }))).toBe(true);
      expect(
        result.current(buildDevice({ enroller: buildEnroller('other'), scope: 'personal' })),
      ).toBe(true);
    });

    it('stays editable when the workspace owner flag is on', () => {
      mocks.isOwner.current = true;
      const { result } = renderHook(() => useCanEditDevice());
      expect(result.current(buildDevice({ scope: 'personal' }))).toBe(true);
    });
  });

  describe('workspace scope', () => {
    it('is editable when the caller is a workspace owner on a persisted row', () => {
      mocks.isOwner.current = true;
      const { result } = renderHook(() => useCanEditDevice());
      expect(
        result.current(
          buildDevice({ enroller: buildEnroller('someone-else'), scope: 'workspace' }),
        ),
      ).toBe(true);
    });

    it('is fail-closed for a workspace owner on a ghost row', () => {
      // No DB row yet → updateWorkspaceDevice / removeWorkspaceDevice would
      // throw NOT_FOUND. The UI must not expose controls that the server will
      // reject.
      mocks.isOwner.current = true;
      const { result } = renderHook(() => useCanEditDevice());
      expect(result.current(buildDevice({ enroller: null, scope: 'workspace' }))).toBe(false);
    });

    it('is editable for a member when they are the enroller', () => {
      const { result } = renderHook(() => useCanEditDevice());
      expect(
        result.current(
          buildDevice({ enroller: buildEnroller('current-user-id'), scope: 'workspace' }),
        ),
      ).toBe(true);
    });

    it('is not editable for a member viewing another member’s device', () => {
      const { result } = renderHook(() => useCanEditDevice());
      expect(
        result.current(
          buildDevice({ enroller: buildEnroller('other-member-id'), scope: 'workspace' }),
        ),
      ).toBe(false);
    });

    it('is fail-closed for a member on a ghost row with no enroller', () => {
      const { result } = renderHook(() => useCanEditDevice());
      expect(result.current(buildDevice({ enroller: null, scope: 'workspace' }))).toBe(false);
    });

    it('is fail-closed for a member when the current user id is unresolved', () => {
      mocks.userState.userId = undefined;
      const { result } = renderHook(() => useCanEditDevice());
      expect(
        result.current(
          buildDevice({ enroller: buildEnroller('current-user-id'), scope: 'workspace' }),
        ),
      ).toBe(false);
    });
  });
});
