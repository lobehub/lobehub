import { describe, expect, it, vi } from 'vitest';

import { DocumentModel } from '@/database/models/document';
import { TopicDocumentModel } from '@/database/models/topicDocument';

import { createServerPlanRuntimeService } from '../lobeAgentPlan';

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn(() => ({
    findById: vi.fn(),
  })),
}));

vi.mock('@/database/models/topicDocument', () => ({
  TopicDocumentModel: vi.fn(() => ({
    findByTopicId: vi.fn(),
  })),
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
});
