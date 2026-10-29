// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AgentDocumentModels from '@/database/models/agentDocuments';
import { createCallerFactory } from '@/libs/trpc/lambda';
import { createContextInner } from '@/libs/trpc/lambda/context';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { agentDocumentRouter } from '../agentDocument';

const mocks = vi.hoisted(() => ({
  getServerDB: vi.fn(),
  getSkill: vi.fn(),
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
vi.mock('@/server/services/skillManagement', () => ({ SkillManagementDocumentService: vi.fn() }));

const createCaller = createCallerFactory(agentDocumentRouter);

describe('agentDocumentRouter.getSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerDB.mockResolvedValue({ kind: 'server-db' });

    vi.mocked(SkillManagementDocumentService).mockImplementation(function () {
      return { getSkill: mocks.getSkill } as unknown as SkillManagementDocumentService;
    });
  });

  it('reads the managed skill with its SKILL.md for this agent', async () => {
    const skill = {
      bundle: { agentDocumentId: 'agd-bundle', documentId: 'docs_bundle' },
      content: '---\nname: lobe-marker-cleanup\n---\nBody',
      index: { agentDocumentId: 'agd-index', documentId: 'docs_index' },
      name: 'lobe-marker-cleanup',
    };
    mocks.getSkill.mockResolvedValue(skill);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));
    const result = await caller.getSkill({ agentDocumentId: 'agd-bundle', agentId: 'agent-1' });

    expect(mocks.getSkill).toHaveBeenCalledWith({
      agentDocumentId: 'agd-bundle',
      agentId: 'agent-1',
      includeContent: true,
    });
    expect(result).toEqual(skill);
  });

  it('answers null once the skill is gone', async () => {
    mocks.getSkill.mockResolvedValue(undefined);

    const caller = createCaller(await createContextInner({ userId: 'user-1' }));

    await expect(
      caller.getSkill({ agentDocumentId: 'agd-deleted', agentId: 'agent-1' }),
    ).resolves.toBeNull();
  });
});
