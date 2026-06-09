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

    expect(DocumentModel).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1');
    expect(TopicDocumentModel).toHaveBeenCalledWith(serverDB, 'user-1', 'workspace-1');
  });
});
