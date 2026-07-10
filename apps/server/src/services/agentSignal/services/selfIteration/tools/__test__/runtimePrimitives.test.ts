import { LayersEnum } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import type { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { createResourceRuntimePrimitives } from '../runtimePrimitives';
import type {
  CreateSkillIfAbsentInput,
  ReplaceSkillContentCASInput,
  WriteMemoryInput,
} from '../shared';

const mocks = vi.hoisted(() => ({
  runMemoryActionAgent: vi.fn(),
}));

vi.mock('@/server/services/agentSignal/policies/analyzeIntent/actions/userMemory', () => ({
  runMemoryActionAgent: mocks.runMemoryActionAgent,
}));

interface TestResourceRuntime {
  createSkillIfAbsent: (input: CreateSkillIfAbsentInput) => Promise<{
    resourceId?: string;
    summary?: string;
  }>;
  replaceSkillContentCAS: (input: ReplaceSkillContentCASInput) => Promise<{
    agentDocumentId?: string;
    documentId?: string;
    historyId?: string;
    resourceId?: string;
    summary?: string;
  }>;
  writeMemory: (input: WriteMemoryInput) => Promise<{
    resourceId?: string;
    summary?: string;
  }>;
}

const createSkillDocumentService = (
  overrides: Partial<SkillManagementDocumentService> = {},
): SkillManagementDocumentService =>
  ({
    createSkill: vi.fn().mockResolvedValue({
      bundle: {
        agentDocumentId: 'adoc_created',
        documentId: 'doc_bundle_created',
      },
      index: {
        agentDocumentId: 'adoc_index_created',
        documentId: 'doc_index_created',
      },
      name: 'support-skill',
      title: 'Support Skill',
    }),
    getSkill: vi.fn(),
    listSkills: vi.fn().mockResolvedValue([]),
    readSkillTargetSnapshot: vi.fn(),
    replaceSkillIndex: vi.fn().mockResolvedValue({
      bundle: {
        agentDocumentId: 'adoc_1',
        documentId: 'doc_bundle_1',
      },
      index: {
        agentDocumentId: 'adoc_index_1',
        documentId: 'doc_index_1',
      },
      name: 'support-skill',
      preMutationHistoryId: 'history_1',
      title: 'Support Skill',
    }),
    ...overrides,
  }) as unknown as SkillManagementDocumentService;

describe('createResourceRuntimePrimitives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves writeMemory target metadata without creating rollback mutations', async () => {
    mocks.runMemoryActionAgent.mockResolvedValue({
      detail: 'Saved tone preference',
      status: 'applied',
      target: {
        id: 'pref_1',
        memoryId: 'mem_1',
        memoryLayer: LayersEnum.Preference,
        summary: 'Use concise implementation notes.',
        title: 'Prefers concise implementation notes',
        type: 'memory',
      },
    });
    const service = createResourceRuntimePrimitives({
      agentId: 'agent_1',
      db: {} as LobeChatDatabase,
      memoryReason: (count) => `reason ${count}`,
      operationId: 'op_1',
      sourceId: 'source_1',
      skillDocumentService: createSkillDocumentService(),
      topicId: 'topic_1',
      userId: 'user_1',
      workspaceId: 'workspace_1',
    }) as unknown as TestResourceRuntime;

    const result = await service.writeMemory({
      content: 'Prefers concise notes.',
      evidenceRefs: [],
      idempotencyKey: 'mem_key_1',
      userId: 'user_1',
    });

    expect(result).toEqual({
      resourceId: 'pref_1',
      summary: 'Saved tone preference',
      target: {
        id: 'pref_1',
        memoryId: 'mem_1',
        memoryLayer: LayersEnum.Preference,
        summary: 'Use concise implementation notes.',
        title: 'Prefers concise implementation notes',
        type: 'memory',
      },
    });
  });

  it('does not create rollback metadata for skill creation', async () => {
    const service = createResourceRuntimePrimitives({
      agentId: 'agent_1',
      db: {} as LobeChatDatabase,
      memoryReason: (count) => `reason ${count}`,
      operationId: 'op_1',
      sourceId: 'source_1',
      skillDocumentService: createSkillDocumentService(),
      topicId: 'topic_1',
      userId: 'user_1',
      workspaceId: 'workspace_1',
    }) as unknown as TestResourceRuntime;

    const result = await service.createSkillIfAbsent({
      bodyMarkdown: 'Use concise support steps.',
      idempotencyKey: 'skill_create_1',
      name: 'support-skill',
      userId: 'user_1',
    });

    expect(result.resourceId).toBe('adoc_created');
  });

  it('returns replaceSkillContentCAS rollback refs from document history', async () => {
    const readSkillTargetSnapshot = vi.fn().mockResolvedValue({
      agentDocumentId: 'adoc_1',
      contentHash: 'sha256:before',
      documentId: 'doc_bundle_1',
      managed: true,
      targetType: 'skill',
      writable: true,
    });
    const service = createResourceRuntimePrimitives({
      agentId: 'agent_1',
      db: {} as LobeChatDatabase,
      memoryReason: (count) => `reason ${count}`,
      operationId: 'op_1',
      sourceId: 'source_1',
      skillDocumentService: createSkillDocumentService({ readSkillTargetSnapshot }),
      topicId: 'topic_1',
      userId: 'user_1',
      workspaceId: 'workspace_1',
    }) as unknown as TestResourceRuntime;

    const result = await service.replaceSkillContentCAS({
      bodyMarkdown: 'Updated skill body.',
      idempotencyKey: 'skill_replace_1',
      skillDocumentId: 'adoc_1',
      userId: 'user_1',
    });

    expect(result).toMatchObject({
      agentDocumentId: 'adoc_1',
      documentId: 'doc_index_1',
      historyId: 'history_1',
      resourceId: 'adoc_1',
      summary: 'Refined managed skill support-skill.',
    });
  });
});
