import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  describeGrant,
  githubAccountState,
  useCredentialGrants,
  useDisconnectGithubAccount,
  useRequesterCredentialPolicy,
} from './useSharedDeviceCredential';

const mocks = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  disconnectIdentity: vi.fn(),
  getPolicy: vi.fn(),
  listGrants: vi.fn(),
  updatePolicy: vi.fn(),
}));

vi.mock('@/services/scm', () => ({
  scmService: {
    disconnectIdentity: mocks.disconnectIdentity,
    getRequesterCredentialPolicy: mocks.getPolicy,
    listCredentialGrants: mocks.listGrants,
    updateRequesterCredentialPolicy: mocks.updatePolicy,
  },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'ws-1',
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirmModal,
}));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

const t = (key: string) => key;

beforeEach(() => {
  vi.clearAllMocks();
  let stored = false;
  mocks.getPolicy.mockImplementation(async () => ({ canEdit: true, enabled: stored }));
  mocks.updatePolicy.mockImplementation(async (enabled: boolean) => {
    stored = enabled;
    return { enabled };
  });
  mocks.disconnectIdentity.mockResolvedValue({ success: true });
});

describe('useRequesterCredentialPolicy', () => {
  it('turns the policy on and keeps the admin flag', async () => {
    const { result } = renderHook(() => useRequesterCredentialPolicy(), { wrapper });
    await waitFor(() => expect(result.current.policy).toBeDefined());

    await act(() => result.current.toggle(true));

    expect(mocks.updatePolicy).toHaveBeenCalledWith(true);
    expect(result.current.policy).toEqual({ canEdit: true, enabled: true });
  });

  it('rolls back and reports when the update is refused', async () => {
    mocks.updatePolicy.mockRejectedValue(new Error('FORBIDDEN'));
    const onError = vi.fn();
    const { result } = renderHook(() => useRequesterCredentialPolicy(onError), { wrapper });
    await waitFor(() => expect(result.current.policy).toBeDefined());

    await act(() => result.current.toggle(true));

    expect(result.current.policy).toEqual({ canEdit: true, enabled: false });
    expect(onError).toHaveBeenCalled();
  });
});

describe('useDisconnectGithubAccount', () => {
  it('disconnects only after the user confirms', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useDisconnectGithubAccount(onDone));

    act(() => result.current());
    expect(mocks.disconnectIdentity).not.toHaveBeenCalled();
    await mocks.confirmModal.mock.calls[0][0].onOk();

    expect(mocks.disconnectIdentity).toHaveBeenCalledWith('github');
    expect(onDone).toHaveBeenCalled();
  });
});

describe('describeGrant', () => {
  const grant = {
    path: 'tool-call' as const,
    repo: null,
    requester: { avatar: null, id: 'user-3', name: null },
    result: 'not_authorized' as const,
  };

  it('labels a refused grant and falls back for a missing name and repository', () => {
    expect(describeGrant(grant, t)).toEqual({
      name: 'user-3',
      path: 'github.grants.path.tool-call',
      repo: 'github.grants.noRepo',
      result: 'github.grants.result.not_authorized',
      tone: 'warning',
    });
  });

  it('marks an issued grant as a success', () => {
    expect(
      describeGrant(
        {
          ...grant,
          repo: 'lobehub/lobehub',
          requester: { ...grant.requester, name: 'Rene' },
          result: 'issued',
        },
        t,
      ),
    ).toMatchObject({ name: 'Rene', repo: 'lobehub/lobehub', tone: 'success' });
  });
});

describe('githubAccountState', () => {
  it('tells a missing, a working and an expired connection apart', () => {
    expect(githubAccountState(null)).toBe('none');
    expect(githubAccountState({ needsReauthorization: false })).toBe('ready');
    expect(githubAccountState({ needsReauthorization: true })).toBe('reauthorize');
  });
});

describe('useCredentialGrants', () => {
  const page = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      createdAt: new Date(Date.UTC(2026, 10, 17, 12, 0, 0) - (from + index) * 60_000),
      id: `grant-${from + index}`,
    }));

  it('pages older grants from the last one shown and stops at the end', async () => {
    mocks.listGrants.mockImplementation(async ({ before }: { before?: Date }) =>
      before ? page(50, 3) : page(0, 50),
    );
    const { result } = renderHook(() => useCredentialGrants({ repo: 'lobehub/lobehub' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.grants).toHaveLength(50));
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.grants).toHaveLength(53));

    expect(mocks.listGrants).toHaveBeenLastCalledWith({
      before: page(49, 1)[0].createdAt,
      limit: 50,
      repo: 'lobehub/lobehub',
      requesterUserId: undefined,
    });
    expect(result.current.hasMore).toBe(false);
  });
});
