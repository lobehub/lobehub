// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { PageAgentInvocationContext, PageAgentRuntimeService } from './index';
import { PageAgentExecutionRuntime } from './index';

const DOC_ID = 'doc_test_1';
const ctxWithDoc: PageAgentInvocationContext = { documentId: DOC_ID, userId: 'u1' };
const ctxNoDoc: PageAgentInvocationContext = { userId: 'u1' };

const buildService = (
  overrides: Partial<PageAgentRuntimeService> = {},
): PageAgentRuntimeService => {
  const ok = async (apiName: string) => ({
    content: `ok:${apiName}`,
    state: { ran: apiName },
  });
  return {
    editTitle: vi.fn(() => ok('editTitle')),
    getPageContent: vi.fn(() => ok('getPageContent')),
    initPage: vi.fn(() => ok('initPage')),
    modifyNodes: vi.fn(() => ok('modifyNodes')),
    replaceText: vi.fn(() => ok('replaceText')),
    ...overrides,
  };
};

describe('PageAgentExecutionRuntime', () => {
  describe('documentId guard', () => {
    it('rejects every API call when documentId is missing', async () => {
      const service = buildService();
      const runtime = new PageAgentExecutionRuntime(service);

      const results = await Promise.all([
        runtime.initPage({ markdown: '# Hi' }, ctxNoDoc),
        runtime.editTitle({ title: 'x' }, ctxNoDoc),
        runtime.getPageContent({}, ctxNoDoc),
        runtime.modifyNodes({ operations: [{ action: 'remove', id: 'a' }] }, ctxNoDoc),
        runtime.replaceText({ newText: 'a', searchText: 'b' }, ctxNoDoc),
      ]);

      for (const result of results) {
        expect(result.success).toBe(false);
        expect((result.error as { type?: string }).type).toBe('PageAgentMissingDocumentId');
      }

      // Service callbacks never invoked.
      expect(service.initPage).not.toHaveBeenCalled();
      expect(service.editTitle).not.toHaveBeenCalled();
      expect(service.getPageContent).not.toHaveBeenCalled();
      expect(service.modifyNodes).not.toHaveBeenCalled();
      expect(service.replaceText).not.toHaveBeenCalled();
    });
  });

  describe('forwarding', () => {
    it('forwards each API call to the service with args + context', async () => {
      const service = buildService();
      const runtime = new PageAgentExecutionRuntime(service);

      await runtime.modifyNodes({ operations: [{ action: 'remove', id: 'a' }] }, ctxWithDoc);

      expect(service.modifyNodes).toHaveBeenCalledWith(
        { operations: [{ action: 'remove', id: 'a' }] },
        ctxWithDoc,
      );
    });

    it('envelopes the service output with success + documentId', async () => {
      const service = buildService({
        modifyNodes: async () => ({
          content: 'changed',
          state: { successCount: 3 },
        }),
      });
      const runtime = new PageAgentExecutionRuntime(service);

      const result = await runtime.modifyNodes(
        { operations: [{ action: 'remove', id: 'a' }] },
        ctxWithDoc,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe('changed');
      expect(result.state).toMatchObject({
        documentId: DOC_ID,
        successCount: 3,
      });
    });
  });

  describe('error envelope', () => {
    it('wraps thrown service errors as PageAgentRuntimeError', async () => {
      const service = buildService({
        modifyNodes: async () => {
          throw new Error('boom');
        },
      });
      const runtime = new PageAgentExecutionRuntime(service);

      const result = await runtime.modifyNodes(
        { operations: [{ action: 'remove', id: 'a' }] },
        ctxWithDoc,
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe('boom');
      expect((result.error as { type?: string }).type).toBe('PageAgentRuntimeError');
    });
  });
});
