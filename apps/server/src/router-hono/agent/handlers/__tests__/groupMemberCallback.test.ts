// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRunIdentity } from '@/server/modules/AgentRuntime/runIdentity';

import { groupMemberCallback } from '../groupMemberCallback';

const mockCompleteGroupActionMember = vi.fn();
const mockGetOperationMetadata = vi.fn();
const mockAiAgentService = vi.fn();
const mockServerDB = vi.hoisted(() => ({ kind: 'server-db' }));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(function (...args: any[]) {
    mockAiAgentService(...args);
    return { completeGroupActionMember: mockCompleteGroupActionMember };
  }),
}));

vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(function () {
    return { getOperationMetadata: mockGetOperationMetadata };
  }),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn().mockResolvedValue(mockServerDB),
}));

function buildContext(body: unknown) {
  return {
    json: (b: any, status = 200) => Response.json(b, { status }),
    req: { json: async () => body },
  } as any;
}

const validBody = {
  anchorMessageId: 'msg-anchor-1',
  expectedMembers: 2,
  groupToolMessageId: 'msg-group-tool-1',
  mode: 'in_group',
  onComplete: 'resume',
  operationId: 'op-member-1',
  parentOperationId: 'op-supervisor-1',
  reason: 'done',
};

const shareVisitor = { shareId: 'share-1', visitorUserId: 'visitor-1' };

describe('groupMemberCallback handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompleteGroupActionMember.mockResolvedValue(true);
  });

  it('keeps the visitor exclusion for an ordinary member run', async () => {
    mockGetOperationMetadata.mockResolvedValue({
      identity: buildRunIdentity({ userId: 'user-1', workspaceId: 'ws-1' }),
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    const res = await groupMemberCallback(buildContext(validBody));

    expect(res.status).toBe(200);
    expect(mockAiAgentService).toHaveBeenCalledWith(mockServerDB, 'user-1', {
      includeShareVisitor: false,
      workspaceId: 'ws-1',
    });
    expect(mockCompleteGroupActionMember).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['its run identity', { identity: buildRunIdentity({ shareVisitor, userId: 'creator-1' }) }],
    ['the streamOwnerUserId marker alone, without an identity snapshot', {}],
  ])('opts into visitor rows for a visitor run read from %s', async (_, extra) => {
    mockGetOperationMetadata.mockResolvedValue({
      ...extra,
      streamOwnerUserId: 'visitor-1',
      userId: 'creator-1',
    });

    const res = await groupMemberCallback(buildContext(validBody));

    expect(res.status).toBe(200);
    expect(mockAiAgentService).toHaveBeenCalledWith(mockServerDB, 'creator-1', {
      includeShareVisitor: true,
      workspaceId: undefined,
    });
  });

  it('refuses a run identity that contradicts its mirror', async () => {
    mockGetOperationMetadata.mockResolvedValue({
      identity: buildRunIdentity({ shareVisitor, userId: 'creator-1' }),
      userId: 'creator-1',
    });

    const res = await groupMemberCallback(buildContext(validBody));

    expect(res.status).toBe(401);
    expect(mockCompleteGroupActionMember).not.toHaveBeenCalled();
  });

  it('returns 401 when the member operation has no metadata', async () => {
    mockGetOperationMetadata.mockResolvedValue(null);

    const res = await groupMemberCallback(buildContext(validBody));

    expect(res.status).toBe(401);
    expect(mockCompleteGroupActionMember).not.toHaveBeenCalled();
  });
});
