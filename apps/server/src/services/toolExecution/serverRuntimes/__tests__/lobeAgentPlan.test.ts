import { AGENT_PLAN_FILE_TYPE } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

import { createServerPlanRuntimeService } from '../lobeAgentPlan';

const mockFindById = vi.fn();
const mockIsAssociated = vi.fn();

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({
    findById: mockFindById,
  })),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(() => ({
    findByTopicId: vi.fn(),
    isAssociated: mockIsAssociated,
  })),
}));

describe('createServerPlanRuntimeService', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockIsAssociated.mockReset();
  });

  it('scopes document models to workspace context', () => {
    const serverDB = {} as never;

    createServerPlanRuntimeService(serverDB, 'user-1', 'workspace-1');

    // 4th arg (callerAgentVisibility) is `undefined` when no agent context
    // is threaded through (e.g. non-tool-runtime callers).
    expect(DocumentModel).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1', undefined);
    expect(TopicDocumentModel).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1');
  });

  it("threads callerAgentVisibility into the plan runtime's DocumentModel", () => {
    // Public-agent gate on the read path + inherit on the write path both
    // flow through the 4th ctor arg. When the agent is private the plan
    // documents inherit that visibility and lands in the caller's private
    // Pages bucket instead of leaking to the workspace.
    const serverDB = {} as never;

    createServerPlanRuntimeService(serverDB, 'user-1', 'workspace-1', 'private');

    expect(DocumentModel).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1', 'private');
  });

  describe('findPlanById restrictToTopicId — share-visitor cross-topic plan access', () => {
    const planDoc = {
      content: 'context',
      createdAt: new Date('2024-01-01'),
      description: 'desc',
      fileType: AGENT_PLAN_FILE_TYPE,
      id: 'docs_creator_plan',
      metadata: null,
      title: 'goal',
      updatedAt: new Date('2024-01-01'),
    };

    it('returns the plan unrestricted when restrictToTopicId is not provided (ordinary, non-share runs)', async () => {
      mockFindById.mockResolvedValue(planDoc);

      const service = createServerPlanRuntimeService({} as never, 'creator-1', 'workspace-1');
      const result = await service.findPlanById('docs_creator_plan');

      expect(result?.id).toBe('docs_creator_plan');
      expect(mockIsAssociated).not.toHaveBeenCalled();
    });

    it('returns the plan when it IS associated with the restricted (visitor) topic', async () => {
      mockFindById.mockResolvedValue(planDoc);
      mockIsAssociated.mockResolvedValue(true);

      const service = createServerPlanRuntimeService(
        {} as never,
        'creator-1',
        'workspace-1',
        undefined,
        'visitor-topic-1',
      );
      const result = await service.findPlanById('docs_creator_plan');

      expect(result?.id).toBe('docs_creator_plan');
      expect(mockIsAssociated).toHaveBeenCalledWith('docs_creator_plan', 'visitor-topic-1');
    });

    it('fails closed (returns null, same as "not found") when the plan belongs to a DIFFERENT topic than the visitor is in', async () => {
      // Regression test: a share visitor whitelisted into `lobe-agent`
      // could call `updatePlan` with any `docs_xxx` id the creator owns — e.g.
      // a plan created in a different topic, or by a different shared agent —
      // and read/overwrite it, because `findPlanById` was only creator-scoped
      // (userId/workspaceId ownership), never topic-scoped. This is the exact
      // cross-topic id path the fix closes.
      mockFindById.mockResolvedValue(planDoc);
      mockIsAssociated.mockResolvedValue(false);

      const service = createServerPlanRuntimeService(
        {} as never,
        'creator-1',
        'workspace-1',
        undefined,
        'visitor-topic-1',
      );
      const result = await service.findPlanById('docs_other_topics_plan');

      expect(result).toBeNull();
      expect(mockIsAssociated).toHaveBeenCalledWith('docs_other_topics_plan', 'visitor-topic-1');
    });

    it('fails closed when the document does not exist, without even checking association', async () => {
      mockFindById.mockResolvedValue(undefined);

      const service = createServerPlanRuntimeService(
        {} as never,
        'creator-1',
        'workspace-1',
        undefined,
        'visitor-topic-1',
      );
      const result = await service.findPlanById('docs_missing');

      expect(result).toBeNull();
      expect(mockIsAssociated).not.toHaveBeenCalled();
    });
  });
});
