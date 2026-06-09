// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { resolveValidWorkspaceIdFromRequest, WORKSPACE_ID_HEADER } from './workspace';

const workspaceFindFirst = vi.fn();
const workspaceMemberFindFirst = vi.fn();

const serverDB = {
  query: {
    workspaceMembers: {
      findFirst: workspaceMemberFindFirst,
    },
    workspaces: {
      findFirst: workspaceFindFirst,
    },
  },
} as unknown as LobeChatDatabase;

const createRequest = (workspaceId?: string | null) => {
  const headers = new Headers();
  if (workspaceId !== undefined && workspaceId !== null)
    headers.set(WORKSPACE_ID_HEADER, workspaceId);

  return new Request('https://app.test/webapi/models/openai', { headers });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveValidWorkspaceIdFromRequest', () => {
  it('returns undefined without querying when the workspace header is missing', async () => {
    await expect(
      resolveValidWorkspaceIdFromRequest({
        req: createRequest(),
        serverDB,
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();

    expect(workspaceFindFirst).not.toHaveBeenCalled();
    expect(workspaceMemberFindFirst).not.toHaveBeenCalled();
  });

  it('trims blank workspace headers and treats them as absent', async () => {
    await expect(
      resolveValidWorkspaceIdFromRequest({
        req: createRequest('   '),
        serverDB,
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();

    expect(workspaceFindFirst).not.toHaveBeenCalled();
    expect(workspaceMemberFindFirst).not.toHaveBeenCalled();
  });

  it('returns undefined when the workspace id does not exist', async () => {
    workspaceFindFirst.mockResolvedValueOnce(undefined);

    await expect(
      resolveValidWorkspaceIdFromRequest({
        req: createRequest(' ws-1 '),
        serverDB,
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();

    expect(workspaceFindFirst).toHaveBeenCalledTimes(1);
    expect(workspaceMemberFindFirst).not.toHaveBeenCalled();
  });

  it('returns undefined when the requester is not an active workspace member', async () => {
    workspaceFindFirst.mockResolvedValueOnce({ id: 'ws-1' });
    workspaceMemberFindFirst.mockResolvedValueOnce(undefined);

    await expect(
      resolveValidWorkspaceIdFromRequest({
        req: createRequest('ws-1'),
        serverDB,
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();

    expect(workspaceMemberFindFirst).toHaveBeenCalledTimes(1);
  });

  it('returns the trimmed workspace id for an existing workspace and active member', async () => {
    workspaceFindFirst.mockResolvedValueOnce({ id: 'ws-1' });
    workspaceMemberFindFirst.mockResolvedValueOnce({ userId: 'user-1' });

    await expect(
      resolveValidWorkspaceIdFromRequest({
        req: createRequest(' ws-1 '),
        serverDB,
        userId: 'user-1',
      }),
    ).resolves.toBe('ws-1');
  });
});
