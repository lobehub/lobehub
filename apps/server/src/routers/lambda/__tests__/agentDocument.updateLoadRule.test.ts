// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AgentDocumentModels from '@/database/models/agentDocuments';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { AgentDocumentVfsError } from '@/server/services/agentDocumentVfs/errors';

import { agentDocumentRouter } from '../agentDocument';

const mocks = vi.hoisted(() => ({
  getServerDB: vi.fn(),
  updateLoadRuleById: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mocks.getServerDB,
}));

vi.mock('@/database/models/agentDocuments', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentDocumentModels>();

  return { ...actual, AgentDocumentModel: vi.fn() };
});

vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/database/models/topicDocument', () => ({ TopicDocumentModel: vi.fn() }));
vi.mock('@/server/services/agentDocuments', () => ({ AgentDocumentsService: vi.fn() }));
vi.mock('@/server/services/agentDocumentVfs', () => ({ AgentDocumentVfsService: vi.fn() }));

const createCaller = createCallerFactory(agentDocumentRouter);

describe('agentDocumentRouter.updateLoadRule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({ kind: 'server-db' });

    vi.mocked(AgentDocumentsService).mockImplementation(function () {
      return { updateLoadRuleById: mocks.updateLoadRuleById } as unknown as AgentDocumentsService;
    });
  });

  // The input schema had no `mode`, so zod stripped it and a
  // progressive document could never be switched to "always" from the client.
  it('passes the load mode through to the service', async () => {
    mocks.updateLoadRuleById.mockResolvedValue({ id: 'agd-1', policyLoad: 'always' });

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.updateLoadRule({
      agentId: 'agent-1',
      id: 'agd-1',
      rule: { maxTokens: 900, mode: 'always', priority: 2 },
    });

    expect(mocks.updateLoadRuleById).toHaveBeenCalledWith(
      'agd-1',
      { maxTokens: 900, mode: 'always', priority: 2 },
      'agent-1',
    );
    expect(result).toEqual({ id: 'agd-1', policyLoad: 'always' });
  });

  it('rejects load modes the tool does not offer', async () => {
    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.updateLoadRule({ agentId: 'agent-1', id: 'agd-1', rule: { mode: 'manual' as any } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.updateLoadRuleById).not.toHaveBeenCalled();
  });

  it('maps a refused mode change to METHOD_NOT_SUPPORTED with its reason', async () => {
    mocks.updateLoadRuleById.mockRejectedValue(
      new AgentDocumentVfsError('Skill documents cannot change mode.', 'METHOD_NOT_SUPPORTED'),
    );

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const call = caller.updateLoadRule({
      agentId: 'agent-1',
      id: 'agd-skill',
      rule: { mode: 'always' },
    });

    await expect(call).rejects.toBeInstanceOf(TRPCError);
    await expect(call).rejects.toMatchObject({
      code: 'METHOD_NOT_SUPPORTED',
      message: 'Skill documents cannot change mode.',
    });
  });
});
