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
  // An agent with thousands of web-crawled docs used to get every row in one
  // result (1.5M chars), overflowing the context window on the next call.
  describe('listDocuments paging', () => {
    const docs = Array.from({ length: 120 }, (_, i) => ({
      documentId: `doc-${i}`,
      filename: `page-${i}.md`,
      id: `agent-doc-${i}`,
      title: `Page ${i}`,
    }));

    it('returns the first page and tells the model how to fetch the next', async () => {
      const runtime = createRuntime({ listDocuments: vi.fn().mockResolvedValue(docs) });

      const result = await runtime.listDocuments({}, { agentId: 'agent-1' });

      expect(result.state?.documents).toHaveLength(50);
      expect(result.content).toContain('"id":"agent-doc-49"');
      expect(result.content).not.toContain('"id":"agent-doc-50"');
      expect(result.content).toContain(
        'Showing documents 1-50 of 120. For the next page call listDocuments with {"limit":50,"offset":50,"scope":"agent","sourceType":"all"}.',
      );
    });

    it('keeps the active filters in the next-page arguments', async () => {
      const runtime = createRuntime({ listTopicDocuments: vi.fn().mockResolvedValue(docs) });

      const result = await runtime.listDocuments(
        { limit: 20, parentId: 'folder-1', scope: 'currentTopic', sourceType: 'web' },
        { agentId: 'agent-1', topicId: 'topic-1' },
      );

      expect(result.content).toContain(
        'For the next page call listDocuments with {"limit":20,"offset":20,"parentId":"folder-1","scope":"currentTopic","sourceType":"web"}.',
      );
    });

    it('pages with offset/limit and omits the note on the last page', async () => {
      const runtime = createRuntime({ listDocuments: vi.fn().mockResolvedValue(docs) });

      const result = await runtime.listDocuments(
        { limit: 1000, offset: 100 },
        { agentId: 'agent-1' },
      );

      expect(result.state?.documents.map((d: { id: string }) => d.id)).toEqual(
        docs.slice(100).map((d) => d.id),
      );
      expect(result.content).not.toContain('Showing documents');
    });
  });

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
        parentId: 'folder-doc-1',
        title: 'Reusable Procedure',
      },
      { agentId: 'agent-1' },
    );

    expect(createDocument).toHaveBeenCalledWith({
      agentId: 'agent-1',
      content: 'steps',
      hintIsSkill: true,
      parentId: 'folder-doc-1',
      title: 'Reusable Procedure',
    });
    expect(result.state).toMatchObject({
      agentDocumentId: 'agent-doc-1',
      agentId: 'agent-1',
      documentId: 'backing-doc-1',
    });
  });

  describe('tool arguments the model gets wrong', () => {
    it('reads by the `documentId` alias when `id` is missing', async () => {
      // Production: readDocument({ documentId: "905d1809-…" }) returned
      // "Document not found: undefined" for documents that existed.
      const readDocument = vi.fn().mockResolvedValue({
        content: 'Working notes',
        documentId: 'docs_test_read',
        id: '905d1809-b765-48bc-890e-84e82d9986e7',
        title: 'Notes',
      });
      const runtime = createRuntime({ readDocument });

      const result = await runtime.readDocument(
        { documentId: '905d1809-b765-48bc-890e-84e82d9986e7', format: 'markdown' } as any,
        { agentId: 'agent-1' },
      );

      expect(readDocument).toHaveBeenCalledWith({
        agentId: 'agent-1',
        format: 'markdown',
        id: '905d1809-b765-48bc-890e-84e82d9986e7',
      });
      expect(result.success).toBe(true);
      expect(result.content).toContain('Working notes');
    });

    it('mutates by the binding id when given a backing `docs_` id', async () => {
      const readDocument = vi.fn().mockResolvedValue({
        documentId: 'docs_test_write',
        id: '6740f044-b58b-47eb-bdc0-21ade6c85eb2',
        title: 'Design Directives',
      });
      const replaceDocumentContent = vi.fn().mockResolvedValue({ title: 'Design Directives' });
      const runtime = createRuntime({ readDocument, replaceDocumentContent });

      const result = await runtime.replaceDocumentContent(
        { content: 'new body', documentId: 'docs_test_write' } as any,
        { agentId: 'agent-1' },
      );

      expect(replaceDocumentContent).toHaveBeenCalledWith(
        expect.objectContaining({ id: '6740f044-b58b-47eb-bdc0-21ade6c85eb2' }),
      );
      expect(result.success).toBe(true);
    });

    it('copies and updates load rules by the binding id when given a backing `docs_` id', async () => {
      const readDocument = vi.fn().mockResolvedValue({
        documentId: 'docs_test_write',
        id: '6740f044-b58b-47eb-bdc0-21ade6c85eb2',
        title: 'Design Directives',
      });
      const copyDocument = vi.fn().mockResolvedValue({
        documentId: 'docs_copy',
        id: 'copy-binding',
        title: 'Design Directives (copy)',
      });
      const updateLoadRule = vi.fn().mockResolvedValue({
        documentId: 'docs_test_write',
        title: 'Design Directives',
      });
      const runtime = createRuntime({ copyDocument, readDocument, updateLoadRule });

      await runtime.copyDocument({ documentId: 'docs_test_write' } as any, {
        agentId: 'agent-1',
      });
      await runtime.updateLoadRule(
        { documentId: 'docs_test_write', rule: { rule: 'always' } } as any,
        { agentId: 'agent-1' },
      );

      expect(copyDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: '6740f044-b58b-47eb-bdc0-21ade6c85eb2' }),
      );
      expect(updateLoadRule).toHaveBeenCalledWith(
        expect.objectContaining({ id: '6740f044-b58b-47eb-bdc0-21ade6c85eb2' }),
      );
    });

    it('does not pre-read when copy already has a binding id', async () => {
      const readDocument = vi.fn();
      const copyDocument = vi.fn().mockResolvedValue({ documentId: 'docs_c', id: 'c', title: 'C' });
      const runtime = createRuntime({ copyDocument, readDocument });

      await runtime.copyDocument({ id: '6740f044-b58b-47eb-bdc0-21ade6c85eb2' } as any, {
        agentId: 'agent-1',
      });

      expect(readDocument).not.toHaveBeenCalled();
    });

    it('explains the missing `id` instead of reporting "Document not found: undefined"', async () => {
      const readDocument = vi.fn();
      const runtime = createRuntime({ readDocument });

      const result = await runtime.readDocument({ format: 'xml' } as any, { agentId: 'agent-1' });

      expect(readDocument).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.content).not.toContain('undefined');
      expect(result.content).toContain('readDocument requires `id`');
    });

    it('rejects createDocument without content instead of crashing', async () => {
      const createDocument = vi.fn();
      const runtime = createRuntime({ createDocument });

      const result = await runtime.createDocument({} as any, { agentId: 'agent-1' });

      expect(createDocument).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.content).toContain('createDocument requires `content`');
    });

    it('passes an empty title through when the model omits it', async () => {
      const createDocument = vi.fn().mockResolvedValue({
        documentId: 'docs_new',
        id: 'agent-doc-new',
        title: 'Research Notes V2',
      });
      const runtime = createRuntime({ createDocument });

      const result = await runtime.createDocument(
        { content: '# Research Notes V2\n\nbody' } as any,
        { agentId: 'agent-1' },
      );

      expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ title: '' }));
      expect(result.success).toBe(true);
      expect(result.content).toContain('Research Notes V2');
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
    expect(result.content).toContain(
      'Line 1 is 500000 characters long and was cut at 200000; the rest of that line cannot be paged.',
    );
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
    expect(result.content).toContain('was cut at 199999');
  });

  it('pages a long document by line with the exact call for the next window', async () => {
    const markdown = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const readDocument = vi.fn().mockResolvedValue({
      content: markdown,
      id: 'agent-doc-1',
      litexml: '',
      title: 'Archive',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument(
      { format: 'markdown', id: 'agent-doc-1', limit: 3, offset: 4 },
      { agentId: 'agent-1' },
    );

    expect(result.content).toBe(
      'line 4\nline 5\nline 6\n[Showing lines 4-6 of 10 lines, 70 characters. To continue, call readDocument again with id="agent-doc-1", format="markdown" and offset=7.]',
    );
    // Paging arguments stay in the runtime; the service only receives the lookup.
    expect(readDocument).toHaveBeenCalledWith(
      expect.not.objectContaining({ limit: expect.anything() }),
    );
  });
});
