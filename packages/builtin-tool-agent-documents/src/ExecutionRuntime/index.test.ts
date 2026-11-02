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

  it('returns an explicit first window for an oversized readDocument and keeps the full snapshot in state', async () => {
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

    expect(result.success).toBe(true);
    expect(result.content).toContain('<document_read_metadata>');
    expect(result.content).toContain('"endOffset":50000');
    expect(result.content).toContain('"hasMore":true');
    expect(result.content).toContain('"nextOffset":50000');
    expect(result.content).toContain('"totalLength":500000');
    expect(result.content).toContain('<document_read_continuation>');
    expect(result.content).not.toContain('truncated');
    expect(result.state).toMatchObject({
      content: hugeMarkdown,
      contentHash: expect.stringMatching(/^sha256:/),
      format: 'xml',
      hasMore: true,
      nextOffset: 50_000,
      range: {
        endLine: 1,
        endOffset: 50_000,
        length: 50_000,
        startLine: 1,
        startOffset: 0,
        totalLength: 500_000,
        totalLines: 1,
      },
      xml: hugeXml,
    });
  });

  it('continues from the exact continuation offset without skipping content', async () => {
    const content = 'alpha\nbeta\ngamma\ndelta';
    const readDocument = vi.fn().mockResolvedValue({
      content,
      id: 'agent-doc-1',
      litexml: content,
      title: 'Lines',
    });
    const runtime = createRuntime({ readDocument });

    const first = await runtime.readDocument(
      { id: 'agent-doc-1', limit: 12 },
      { agentId: 'agent-1' },
    );
    expect(first.state).toMatchObject({
      hasMore: true,
      nextOffset: 11,
      range: {
        endLine: 2,
        endOffset: 11,
        length: 11,
        startLine: 1,
        startOffset: 0,
        totalLength: content.length,
        totalLines: 4,
      },
    });
    expect(first.content).toContain('alpha\nbeta\n');
    expect(first.content).toContain('"offset":11');

    const second = await runtime.readDocument(
      { id: 'agent-doc-1', limit: 12, offset: 11 },
      { agentId: 'agent-1' },
    );
    expect(second.state).toMatchObject({
      hasMore: false,
      range: {
        endLine: 4,
        endOffset: content.length,
        length: content.length - 11,
        startLine: 3,
        startOffset: 11,
        totalLength: content.length,
        totalLines: 4,
      },
    });
    expect(second.content).toContain('gamma\ndelta');
    expect(second.content).toContain('<document_read_complete />');
    expect(second.content).not.toContain('<document_read_continuation>');
  });

  it('keeps the source hash stable across regenerated editor XML snapshots', async () => {
    const content = 'alpha\nbeta\ngamma\ndelta';
    const readDocument = vi
      .fn()
      .mockResolvedValueOnce({
        content,
        id: 'agent-doc-1',
        litexml: '<root><p id="first">alpha</p></root>',
      })
      .mockResolvedValueOnce({
        content,
        id: 'agent-doc-1',
        litexml: '<root><p id="second">alpha</p></root>',
      });
    const runtime = createRuntime({ readDocument });

    const first = await runtime.readDocument(
      { format: 'markdown', id: 'agent-doc-1', limit: 12 },
      { agentId: 'agent-1' },
    );
    const second = await runtime.readDocument(
      { format: 'markdown', id: 'agent-doc-1', limit: 12, offset: 11 },
      { agentId: 'agent-1' },
    );

    expect(first.state?.contentHash).toMatch(/^sha256:/);
    expect(second.state?.contentHash).toBe(first.state?.contentHash);
  });

  it('fails closed for invalid readDocument windows', async () => {
    const readDocument = vi.fn().mockResolvedValue({
      content: 'content',
      id: 'agent-doc-1',
      litexml: '<doc>content</doc>',
    });
    const runtime = createRuntime({ readDocument });

    await expect(
      runtime.readDocument({ id: 'agent-doc-1', offset: -1 }, { agentId: 'agent-1' }),
    ).resolves.toMatchObject({
      content: 'Invalid readDocument offset: expected a non-negative integer.',
      success: false,
    });
    await expect(
      runtime.readDocument({ id: 'agent-doc-1', limit: 0 }, { agentId: 'agent-1' }),
    ).resolves.toMatchObject({
      content: 'Invalid readDocument limit: expected an integer from 1 to 200000.',
      success: false,
    });
    await expect(
      runtime.readDocument({ id: 'agent-doc-1', limit: 200_001 }, { agentId: 'agent-1' }),
    ).resolves.toMatchObject({ success: false });
  });

  it('does not add window metadata when a read is complete from offset zero', async () => {
    const readDocument = vi.fn().mockResolvedValue({
      content: 'short markdown',
      id: 'agent-doc-1',
      litexml: '<doc>short</doc>',
      title: 'Small Doc',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument({ id: 'agent-doc-1' }, { agentId: 'agent-1' });

    expect(result.content).toBe('<doc>short</doc>');
    expect(result.state).toMatchObject({
      format: 'xml',
      hasMore: false,
      range: {
        endLine: 1,
        endOffset: 16,
        length: 16,
        startLine: 1,
        startOffset: 0,
        totalLength: 16,
        totalLines: 1,
      },
    });
  });

  it('never splits a surrogate pair and advances the continuation past the whole code point', async () => {
    // Place a 2-code-unit emoji so its high surrogate sits exactly at the
    // default window boundary; a naive slice would emit a lone `\uD83D`.
    const content = `${'a'.repeat(49_999)}😀${'b'.repeat(2000)}`;
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
    // JSON.stringify is the provider-wire serialization this regression protects.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    expect(() => JSON.parse(JSON.stringify(result.content))).not.toThrow();
    expect(result.state).toMatchObject({ hasMore: true, nextOffset: 49_999 });

    const next = await runtime.readDocument(
      { id: 'agent-doc-1', limit: 4, offset: 49_999 },
      { agentId: 'agent-1' },
    );
    expect(next.content).toContain('😀');
    expect(next.content).not.toMatch(loneSurrogate);
  });

  it('returns per-format ranges and continuations for format=both', async () => {
    const markdown = 'm'.repeat(60_000);
    const xml = 'x'.repeat(70_000);
    const readDocument = vi.fn().mockResolvedValue({
      content: markdown,
      id: 'agent-doc-1',
      litexml: xml,
      title: 'Both',
    });
    const runtime = createRuntime({ readDocument });

    const result = await runtime.readDocument(
      { format: 'both', id: 'agent-doc-1', limit: 50_000 },
      { agentId: 'agent-1' },
    );
    const content = JSON.parse(result.content as string);

    expect(content.continuations).toEqual({
      markdown: { format: 'markdown', id: 'agent-doc-1', limit: 50_000, offset: 50_000 },
      xml: { format: 'xml', id: 'agent-doc-1', limit: 50_000, offset: 50_000 },
    });
    expect(content.ranges.markdown).toMatchObject({
      endOffset: 50_000,
      startOffset: 0,
      totalLength: 60_000,
    });
    expect(content.ranges.xml).toMatchObject({
      endOffset: 50_000,
      startOffset: 0,
      totalLength: 70_000,
    });
    expect(result.state).toMatchObject({
      continuations: content.continuations,
      format: 'both',
      hasMore: true,
      ranges: content.ranges,
    });
  });

  it('fails closed when the document is not found', async () => {
    const runtime = createRuntime({ readDocument: vi.fn().mockResolvedValue(undefined) });

    await expect(runtime.readDocument({ id: 'missing' }, { agentId: 'agent-1' })).resolves.toEqual({
      content: 'Document not found: missing',
      success: false,
    });
  });
});
