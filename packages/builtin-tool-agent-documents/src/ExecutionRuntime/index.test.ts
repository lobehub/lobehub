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

  it('forwards tool trigger metadata when creating documents with same-turn tool context', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      documentId: 'backing-doc-1',
      id: 'agent-doc-1',
      title: 'Research Notes',
    });
    const runtime = createRuntime({ createDocument });

    await runtime.createDocument(
      {
        content: 'notes',
        title: 'Research Notes',
      },
      {
        agentId: 'agent-1',
        messageId: 'user-msg-1',
        operationId: 'op-client-1',
        toolCallId: 'call-create-doc-1',
        topicId: 'topic-1',
      },
    );

    expect(createDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'notes',
      title: 'Research Notes',
      toolContext: {
        messageId: 'user-msg-1',
        operationId: 'op-client-1',
        toolCallId: 'call-create-doc-1',
        topicId: 'topic-1',
      },
      trigger: 'tool',
    });
  });

  it('does not forward tool trigger metadata without required attribution ids', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      id: 'agent-doc-1',
      title: 'Draft',
    });
    const runtime = createRuntime({ createDocument });

    await runtime.createDocument(
      {
        content: 'draft',
        title: 'Draft',
      },
      { agentId: 'agent-1', messageId: 'user-msg-1' },
    );

    await runtime.createDocument(
      {
        content: 'draft',
        title: 'Draft',
      },
      { agentId: 'agent-1', toolCallId: 'call-create-doc-1' },
    );

    expect(createDocument).toHaveBeenNthCalledWith(1, {
      agentId: 'agent-1',
      content: 'draft',
      title: 'Draft',
    });
    expect(createDocument).toHaveBeenNthCalledWith(2, {
      agentId: 'agent-1',
      content: 'draft',
      title: 'Draft',
    });
  });
});
