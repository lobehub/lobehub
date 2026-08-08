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
      agentId: 'agent-1',
      documentId: 'backing-doc-1',
    });
  });

  it('surfaces the identity block and pre-reads documentId when removing a document', async () => {
    const readDocument = vi.fn().mockResolvedValue({
      documentId: 'backing-doc-1',
      id: 'agent-doc-1',
      title: 'Doomed',
    });
    const removeDocument = vi.fn().mockResolvedValue(true);
    const runtime = createRuntime({ readDocument, removeDocument });

    const result = await runtime.removeDocument({ id: 'agent-doc-1' }, { agentId: 'agent-1' });

    expect(readDocument).toHaveBeenCalledWith({ agentId: 'agent-1', id: 'agent-doc-1' });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      agentDocumentId: 'agent-doc-1',
      agentId: 'agent-1',
      deleted: true,
      documentId: 'backing-doc-1',
    });
  });

  it('returns a not-found result when removeDocument pre-read misses', async () => {
    const readDocument = vi.fn().mockResolvedValue(undefined);
    const removeDocument = vi.fn();
    const runtime = createRuntime({ readDocument, removeDocument });

    const result = await runtime.removeDocument({ id: 'missing' }, { agentId: 'agent-1' });

    expect(result.success).toBe(false);
    expect(result.content).toBe('Document not found: missing');
    expect(removeDocument).not.toHaveBeenCalled();
  });

  it('awaits an async document URL builder', async () => {
    const createDocument = vi.fn().mockResolvedValue({
      documentId: 'docs_backing-doc-1',
      id: 'agent-doc-1',
      title: 'Research Notes',
    });
    const runtime = new AgentDocumentsExecutionRuntime(
      {
        copyDocument: vi.fn(),
        createDocument,
        createTopicDocument: vi.fn(),
        listDocuments: vi.fn(),
        listTopicDocuments: vi.fn(),
        modifyNodes: vi.fn(),
        readDocument: vi.fn(),
        removeDocument: vi.fn(),
        renameDocument: vi.fn(),
        replaceDocumentContent: vi.fn(),
        updateLoadRule: vi.fn(),
      },
      {
        getDocumentUrl: async ({ agentId, documentId }) =>
          `https://app.example.com/acme/agent/${agentId}/docs/${documentId}`,
      },
    );

    const result = await runtime.createDocument(
      {
        content: 'notes',
        title: 'Research Notes',
      },
      { agentId: 'agent-1' },
    );

    expect(result.content).toContain(
      'https://app.example.com/acme/agent/agent-1/docs/docs_backing-doc-1',
    );
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
        threadId: 'thread-1',
        toolCallId: 'call-create-doc-1',
        toolMessageId: 'tool-msg-1',
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
        threadId: 'thread-1',
        toolCallId: 'call-create-doc-1',
        toolMessageId: 'tool-msg-1',
        topicId: 'topic-1',
      },
      trigger: 'tool',
    });
  });

  it('forwards tool trigger metadata when mutating documents with same-turn tool context', async () => {
    const readDocument = vi.fn().mockResolvedValue({
      documentId: 'backing-doc-1',
      id: 'agent-doc-1',
      title: 'Research Notes',
    });
    const renameDocument = vi.fn().mockResolvedValue({
      documentId: 'backing-doc-1',
      id: 'agent-doc-1',
      title: 'Renamed Notes',
    });
    const runtime = createRuntime({ readDocument, renameDocument });

    await runtime.renameDocument(
      {
        id: 'agent-doc-1',
        newTitle: 'Renamed Notes',
      },
      {
        agentId: 'agent-1',
        messageId: 'user-msg-1',
        operationId: 'op-client-1',
        rootOperationId: 'op-root-1',
        threadId: 'thread-1',
        toolCallId: 'call-rename-doc-1',
        toolMessageId: 'tool-msg-rename-1',
        topicId: 'topic-1',
      },
    );

    expect(renameDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      id: 'agent-doc-1',
      newTitle: 'Renamed Notes',
      toolContext: {
        messageId: 'user-msg-1',
        operationId: 'op-client-1',
        rootOperationId: 'op-root-1',
        threadId: 'thread-1',
        toolCallId: 'call-rename-doc-1',
        toolMessageId: 'tool-msg-rename-1',
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

  it('truncates an oversized readDocument content but keeps full content in state', async () => {
    const hugeXml = 'x'.repeat(500_000);
    const hugeMarkdown = 'm'.repeat(500_000);
    const readDocument = vi.fn().mockResolvedValue({
      content: hugeMarkdown,
      id: 'agent-doc-1',
      litexml: hugeXml,
      title: 'Newsletter Archive',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument({ id: 'agent-doc-1' }, { agentId: 'agent-1' });

    // LLM-facing content is capped well below the raw 500k chars.
    expect(result.content.length).toBeLessThan(hugeXml.length);
    expect(result.content).toContain('document truncated to fit the context window');
    // Inspector still receives the untruncated document via state.
    expect(result.state).toMatchObject({ content: hugeMarkdown, xml: hugeXml });
  });

  it('does not truncate a readDocument content under the cap', async () => {
    const readDocument = vi.fn().mockResolvedValue({
      content: 'short markdown',
      id: 'agent-doc-1',
      litexml: '<doc>short</doc>',
      title: 'Small Doc',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument({ id: 'agent-doc-1' }, { agentId: 'agent-1' });

    expect(result.content).toBe('<doc>short</doc>');
    expect(result.content).not.toContain('document truncated');
  });

  it('does not split a surrogate pair when the cutoff lands mid-emoji', async () => {
    // Place a 2-code-unit emoji so its high surrogate sits exactly at the
    // 200,000-char cutoff; a naive slice would emit a lone `\uD83D`, which some
    // providers reject and would re-break the large-document request.
    const content = `${'a'.repeat(199_999)}😀${'b'.repeat(2000)}`;
    const readDocument = vi.fn().mockResolvedValue({
      content: 'markdown',
      id: 'agent-doc-1',
      litexml: content,
      title: 'Emoji Archive',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument({ id: 'agent-doc-1' }, { agentId: 'agent-1' });

    // No lone high/low surrogate survives in the LLM-facing content.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(result.content).not.toMatch(loneSurrogate);
    // JSON serialization (the actual failure surface) stays well-formed.
    expect(() => JSON.parse(JSON.stringify(result.content))).not.toThrow();
    expect(result.content).toContain('document truncated to fit the context window');
  });
});
