import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

import { createServerPlanRuntimeService } from '../lobeAgentPlan';

const mocks = vi.hoisted(() => ({
  assertWrite: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/server/services/document/writeLimit', () => ({
  assertDocumentWriteWithinLimit: mocks.assertWrite,
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(function () {
    return {
      create: mocks.create,
      findById: mocks.findById,
      update: mocks.update,
    };
  }),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(function () {
    return {
      associate: vi.fn(),
      findByTopicId: vi.fn(),
    };
  }),
}));

describe('createServerPlanRuntimeService', () => {
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

  describe('document character limit', () => {
    const doc = { id: 'plan-1', content: 'old', title: 'g', description: 'd', metadata: null };

    beforeEach(() => {
      for (const mock of Object.values(mocks)) mock.mockReset();
      mocks.create.mockResolvedValue(doc);
      mocks.findById.mockResolvedValue(doc);
    });

    it('checks a new plan as an agent write before creating it', async () => {
      const service = createServerPlanRuntimeService({} as never, 'user-1', 'ws-1');

      await service.createPlan({ content: 'abcd', description: 'd', goal: 'g', topicId: 't' });

      expect(mocks.assertWrite).toHaveBeenCalledWith({
        charCount: 4,
        source: 'agent',
        userId: 'user-1',
        workspaceId: 'ws-1',
      });
    });

    it('creates nothing when the limit refuses a new plan', async () => {
      mocks.assertWrite.mockRejectedValue(new Error('too long'));
      const service = createServerPlanRuntimeService({} as never, 'user-1');

      await expect(
        service.createPlan({ content: 'abcd', description: 'd', goal: 'g', topicId: 't' }),
      ).rejects.toThrow('too long');
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it('checks a plan update against the previous length', async () => {
      const service = createServerPlanRuntimeService({} as never, 'user-1');

      await service.updatePlan('plan-1', { content: 'abcdef' });

      expect(mocks.assertWrite).toHaveBeenCalledWith({
        charCount: 6,
        previousCharCount: 3,
        source: 'agent',
        userId: 'user-1',
        workspaceId: undefined,
      });
    });

    it('does not update when the limit refuses the write', async () => {
      mocks.assertWrite.mockRejectedValue(new Error('too long'));
      const service = createServerPlanRuntimeService({} as never, 'user-1');

      await expect(service.updatePlan('plan-1', { content: 'abcdef' })).rejects.toThrow('too long');
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('skips the check for a goal-only update', async () => {
      const service = createServerPlanRuntimeService({} as never, 'user-1');

      await service.updatePlan('plan-1', { goal: 'new goal' });

      expect(mocks.assertWrite).not.toHaveBeenCalled();
    });
  });
});
