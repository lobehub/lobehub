import { describe, expect, it, vi } from 'vitest';

import { AgentDocumentsExecutionRuntime } from './index';

const createRuntime = (overrides = {}) =>
  new AgentDocumentsExecutionRuntime({
    copyDocument: vi.fn(),
    createDocument: vi.fn(),
    createTopicDocument: vi.fn(),
    listDocuments: vi.fn(),
    listTopicDocuments: vi.fn(),
    modifyNodes: vi.fn(),
    readDocument: vi.fn(),
    removeDocument: vi.fn(),
    renameDocument: vi.fn(),
    replaceDocumentContent: vi.fn(),
    updateLoadRule: vi.fn(),
    ...overrides,
  });

describe('AgentDocumentsExecutionRuntime', () => {
  it('returns agentDocumentId and documentId when creating hinted documents', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      documentId: 'backing-doc-1',
      id: 'agent-doc-1',
      title: 'Reusable Procedure',
    });
    const runtime = createRuntime({ createDocument });

    const result = await runtime.createDocument(
      {
        content: 'steps',
        hintIsSkill: true,
        title: 'Reusable Procedure',
      },
      { agentId: 'agent-1' },
    );

    expect(createDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'steps',
      hintIsSkill: true,
      title: 'Reusable Procedure',
    });
    expect(result.state).toMatchObject({
      agentDocumentId: 'agent-doc-1',
      documentId: 'backing-doc-1',
    });
  });
});
