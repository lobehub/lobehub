import { describe, expect, it, vi } from 'vitest';

import type { DocumentRuntimeService } from '../types';
import { DocumentRuntime } from './index';

const createService = (
  overrides: Partial<DocumentRuntimeService> = {},
): DocumentRuntimeService => ({
  createDocument: vi.fn(),
  listDocuments: vi.fn(),
  modifyNodes: vi.fn(),
  readDocument: vi.fn(),
  replaceContent: vi.fn(),
  ...overrides,
});

describe('DocumentRuntime.buildToolTriggerInput', () => {
  it('returns empty input without messageId or toolCallId', () => {
    expect(DocumentRuntime.buildToolTriggerInput()).toEqual({});
    expect(DocumentRuntime.buildToolTriggerInput({ messageId: 'm-1' })).toEqual({});
    expect(DocumentRuntime.buildToolTriggerInput({ toolCallId: 'c-1' })).toEqual({});
  });

  it('builds tool trigger input with optional attribution fields', () => {
    expect(
      DocumentRuntime.buildToolTriggerInput({
        messageId: 'm-1',
        operationId: 'op-1',
        taskId: 'task-1',
        toolCallId: 'c-1',
        topicId: 't-1',
      }),
    ).toEqual({
      toolContext: {
        messageId: 'm-1',
        operationId: 'op-1',
        taskId: 'task-1',
        toolCallId: 'c-1',
        topicId: 't-1',
      },
      trigger: 'tool',
    });
  });

  it('omits attribution fields that are falsy', () => {
    expect(DocumentRuntime.buildToolTriggerInput({ messageId: 'm-1', toolCallId: 'c-1' })).toEqual({
      toolContext: { messageId: 'm-1', toolCallId: 'c-1' },
      trigger: 'tool',
    });
  });
});

describe('DocumentRuntime.formatDocumentReadContent', () => {
  const runtime = new DocumentRuntime(createService());

  it('returns xml by default and falls back to markdown', () => {
    expect(runtime.formatDocumentReadContent({ id: '1', litexml: '<x/>', content: 'md' })).toBe(
      '<x/>',
    );
    expect(runtime.formatDocumentReadContent({ id: '1', content: 'md' })).toBe('md');
  });

  it('returns markdown when requested', () => {
    expect(
      runtime.formatDocumentReadContent({ id: '1', content: 'md', litexml: '<x/>' }, 'markdown'),
    ).toBe('md');
  });

  it('returns serialized both when requested', () => {
    expect(
      runtime.formatDocumentReadContent({ id: '1', content: 'md', litexml: '<x/>' }, 'both'),
    ).toBe(JSON.stringify({ markdown: 'md', xml: '<x/>' }));
  });
});

describe('DocumentRuntime.createDocument', () => {
  it('routes through the service with built trigger input and shapes success', async () => {
    const createDocument = vi
      .fn()
      .mockResolvedValue({ documentId: 'doc-1', id: 'rec-1', title: 'T' });
    const runtime = new DocumentRuntime(createService({ createDocument }));

    const result = await runtime.createDocument(
      { content: 'body', title: 'T' },
      {
        failureContent: 'fail',
        successContent: (doc) => `created ${doc.id}`,
        successState: (doc) => ({ documentId: doc.documentId }),
        triggerContext: { messageId: 'm-1', toolCallId: 'c-1' },
      },
    );

    expect(createDocument).toHaveBeenCalledWith({
      content: 'body',
      title: 'T',
      toolContext: { messageId: 'm-1', toolCallId: 'c-1' },
      trigger: 'tool',
    });
    expect(result).toEqual({
      content: 'created rec-1',
      state: { documentId: 'doc-1' },
      success: true,
    });
  });

  it('forwards extra create params through to the service alongside trigger input', async () => {
    const createDocument = vi.fn().mockResolvedValue({ id: 'rec-1', title: 'T' });
    const runtime = new DocumentRuntime(createService({ createDocument }));

    await runtime.createDocument(
      { content: 'body', hintIsSkill: true, scope: 'currentTopic', title: 'T' },
      {
        failureContent: 'fail',
        successContent: () => 'ok',
        successState: () => ({}),
        triggerContext: { messageId: 'm-1', toolCallId: 'c-1' },
      },
    );

    expect(createDocument).toHaveBeenCalledWith({
      content: 'body',
      hintIsSkill: true,
      scope: 'currentTopic',
      title: 'T',
      toolContext: { messageId: 'm-1', toolCallId: 'c-1' },
      trigger: 'tool',
    });
  });

  it('returns failure when service returns nothing', async () => {
    const runtime = new DocumentRuntime(
      createService({ createDocument: vi.fn().mockResolvedValue(undefined) }),
    );

    const result = await runtime.createDocument(
      { content: 'body', title: 'T' },
      { failureContent: 'fail', successContent: () => 'ok', successState: () => ({}) },
    );

    expect(result).toEqual({ content: 'fail', success: false });
  });
});

describe('DocumentRuntime.readDocument', () => {
  it('formats found documents', async () => {
    const runtime = new DocumentRuntime(
      createService({
        readDocument: vi
          .fn()
          .mockResolvedValue({ content: 'md', id: 'rec-1', litexml: '<x/>', title: 'T' }),
      }),
    );

    const result = await runtime.readDocument(
      { format: 'both', id: 'rec-1' },
      { notFoundContent: (id) => `missing ${id}` },
    );

    expect(result).toEqual({
      content: JSON.stringify({ markdown: 'md', xml: '<x/>' }),
      state: { content: 'md', id: 'rec-1', title: 'T', xml: '<x/>' },
      success: true,
    });
  });

  it('returns not found content', async () => {
    const runtime = new DocumentRuntime(
      createService({ readDocument: vi.fn().mockResolvedValue(undefined) }),
    );

    const result = await runtime.readDocument(
      { id: 'rec-1' },
      { notFoundContent: (id) => `missing ${id}` },
    );

    expect(result).toEqual({ content: 'missing rec-1', success: false });
  });
});

describe('DocumentRuntime.replaceContent', () => {
  it('shapes success', async () => {
    const replaceContent = vi.fn().mockResolvedValue({ id: 'rec-1' });
    const runtime = new DocumentRuntime(createService({ replaceContent }));

    const result = await runtime.replaceContent(
      { content: 'next', id: 'rec-1' },
      { failureContent: (id) => `fail ${id}`, successContent: (id) => `ok ${id}` },
    );

    expect(replaceContent).toHaveBeenCalledWith({ content: 'next', id: 'rec-1' });
    expect(result).toEqual({
      content: 'ok rec-1',
      state: { id: 'rec-1', updated: true },
      success: true,
    });
  });

  it('shapes failure', async () => {
    const runtime = new DocumentRuntime(
      createService({ replaceContent: vi.fn().mockResolvedValue(undefined) }),
    );

    const result = await runtime.replaceContent(
      { content: 'next', id: 'rec-1' },
      { failureContent: (id) => `fail ${id}`, successContent: (id) => `ok ${id}` },
    );

    expect(result).toEqual({ content: 'fail rec-1', success: false });
  });
});

describe('DocumentRuntime.modifyNodes', () => {
  it('rejects empty operations', async () => {
    const modifyNodes = vi.fn();
    const runtime = new DocumentRuntime(createService({ modifyNodes }));

    const result = await runtime.modifyNodes(
      { id: 'rec-1', operations: [] },
      {
        emptyOperationsContent: 'none',
        failureContent: (id) => `fail ${id}`,
        successContent: (id, count) => `ok ${id} ${count}`,
      },
    );

    expect(modifyNodes).not.toHaveBeenCalled();
    expect(result).toEqual({ content: 'none', success: false });
  });

  it('applies operations and reports per-operation results', async () => {
    const modifyNodes = vi.fn().mockResolvedValue({ id: 'rec-1' });
    const runtime = new DocumentRuntime(createService({ modifyNodes }));

    const result = await runtime.modifyNodes(
      {
        id: 'rec-1',
        operations: [
          { action: 'insert', afterId: 'n-1', litexml: '<a/>' },
          { action: 'remove', id: 'n-2' },
        ],
      },
      {
        emptyOperationsContent: 'none',
        failureContent: (id) => `fail ${id}`,
        successContent: (id, count) => `ok ${id} ${count}`,
      },
    );

    expect(modifyNodes).toHaveBeenCalledWith({
      id: 'rec-1',
      operations: [
        { action: 'insert', afterId: 'n-1', litexml: '<a/>' },
        { action: 'remove', id: 'n-2' },
      ],
    });
    expect(result).toEqual({
      content: 'ok rec-1 2',
      state: {
        id: 'rec-1',
        results: [
          { action: 'insert', success: true },
          { action: 'remove', success: true },
        ],
        successCount: 2,
        totalCount: 2,
      },
      success: true,
    });
  });

  it('shapes failure when service returns nothing', async () => {
    const runtime = new DocumentRuntime(
      createService({ modifyNodes: vi.fn().mockResolvedValue(undefined) }),
    );

    const result = await runtime.modifyNodes(
      { id: 'rec-1', operations: [{ action: 'remove', id: 'n-1' }] },
      {
        emptyOperationsContent: 'none',
        failureContent: (id) => `fail ${id}`,
        successContent: (id, count) => `ok ${id} ${count}`,
      },
    );

    expect(result).toEqual({ content: 'fail rec-1', success: false });
  });
});

describe('DocumentRuntime.listDocuments', () => {
  it('shapes the document list and falls back filename to title', async () => {
    const listDocuments = vi.fn().mockResolvedValue([
      { documentId: 'doc-1', filename: 'f-1', id: 'rec-1', title: 'T1' },
      { id: 'rec-2', title: 'T2' },
    ]);
    const runtime = new DocumentRuntime(createService({ listDocuments }));

    const result = await runtime.listDocuments();

    const documents = [
      { documentId: 'doc-1', filename: 'f-1', id: 'rec-1', title: 'T1' },
      { filename: 'T2', id: 'rec-2', title: 'T2' },
    ];
    expect(result).toEqual({
      content: JSON.stringify(documents),
      state: { documents },
      success: true,
    });
  });
});
