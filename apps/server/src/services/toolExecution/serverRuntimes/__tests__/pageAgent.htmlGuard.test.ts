// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pageAgentRuntime } from '../pageAgent';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  runWithDocumentLock: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock('@/database/models/document', () => ({
  DocumentModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.findById };
  }),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return {
      runWithDocumentLock: mocks.runWithDocumentLock,
      updateDocument: mocks.updateDocument,
    };
  }),
}));

const runtime = () =>
  pageAgentRuntime.factory({ serverDB: {} as any, userId: 'user-1' } as any) as Record<
    string,
    (args: unknown, ctx: unknown) => Promise<any>
  >;

describe('page agent on an HTML page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runWithDocumentLock.mockImplementation((_id: string, fn: () => unknown) => fn());
    mocks.findById.mockResolvedValue({
      content: '<!doctype html><html><body><p>12</p></body></html>',
      editorData: null,
      fileType: 'custom/html',
      id: 'doc-1',
      title: 'Goal report',
    });
  });

  it('refuses node edits instead of writing the page back as Markdown', async () => {
    const result = await runtime().modifyNodes(
      { operations: [{ action: 'remove', id: 'n1' }] },
      { documentId: 'doc-1' },
    );

    expect(result.success).toBe(false);
    expect(result.content).toMatch(/HTML page/);
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it('refuses reads, which would hand the model the HTML parsed as Markdown', async () => {
    const result = await runtime().getPageContent({ format: 'both' }, { documentId: 'doc-1' });

    expect(result.success).toBe(false);
  });
});
