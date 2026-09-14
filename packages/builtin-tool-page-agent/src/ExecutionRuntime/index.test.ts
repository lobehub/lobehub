// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { PageAgentInvocationContext, PageAgentRuntimeService } from './index';
import { PageAgentExecutionRuntime } from './index';

const DOC_ID = 'doc_test_1';
const ctxWithDoc: PageAgentInvocationContext = { documentId: DOC_ID, userId: 'u1' };
const ctxCollaborativePage: PageAgentInvocationContext = {
  documentId: DOC_ID,
  scope: 'page',
  userId: 'u1',
  workspaceId: 'workspace-1',
};
const ctxPersonalPage: PageAgentInvocationContext = {
  documentId: DOC_ID,
  scope: 'page',
  userId: 'u1',
};
const ctxNonPage: PageAgentInvocationContext = {
  documentId: DOC_ID,
  scope: 'main',
  userId: 'u1',
};
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
    rewriteSelection: vi.fn(() => ok('rewriteSelection')),
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
        runtime.rewriteSelection({ requestId: 'request-1' }, ctxNoDoc),
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
      expect(service.rewriteSelection).not.toHaveBeenCalled();
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

  describe('collaborative Page body routing', () => {
    it.each([
      ['workspace', ctxCollaborativePage],
      ['personal', ctxPersonalPage],
    ])(
      'fails closed for %s Page legacy DB body mutations instead of claiming success',
      async (_scope, ctx) => {
        const service = buildService();
        const runtime = new PageAgentExecutionRuntime(service);

        const results = await Promise.all([
          runtime.initPage({ markdown: '# blocked' }, ctx),
          runtime.modifyNodes({ operations: [{ action: 'remove', id: 'a' }] }, ctx),
          runtime.replaceText({ newText: 'new', searchText: 'old' }, ctx),
        ]);

        for (const result of results) {
          expect(result.success).toBe(false);
          expect((result.error as { type?: string }).type).toBe('PageAgentCollaborationBodyOwned');
        }
        expect(service.initPage).not.toHaveBeenCalled();
        expect(service.modifyNodes).not.toHaveBeenCalled();
        expect(service.replaceText).not.toHaveBeenCalled();
      },
    );

    it('keeps metadata, reads, and the room-backed rewrite bridge available', async () => {
      const service = buildService();
      const runtime = new PageAgentExecutionRuntime(service);

      await expect(
        runtime.editTitle({ title: 'New title' }, ctxCollaborativePage),
      ).resolves.toMatchObject({
        success: true,
      });
      await expect(runtime.getPageContent({}, ctxCollaborativePage)).resolves.toMatchObject({
        success: true,
      });
      await expect(
        runtime.rewriteSelection({ requestId: 'request-1' }, ctxCollaborativePage),
      ).resolves.toMatchObject({ success: true });
      expect(service.editTitle).toHaveBeenCalled();
      expect(service.getPageContent).toHaveBeenCalled();
      expect(service.rewriteSelection).toHaveBeenCalled();
    });

    it('does not apply the Page guard to non-page legacy scopes', async () => {
      const service = buildService();
      const runtime = new PageAgentExecutionRuntime(service);

      await expect(
        runtime.modifyNodes({ operations: [{ action: 'remove', id: 'a' }] }, ctxNonPage),
      ).resolves.toMatchObject({ success: true });
      expect(service.modifyNodes).toHaveBeenCalledWith(
        { operations: [{ action: 'remove', id: 'a' }] },
        ctxNonPage,
      );
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

  describe('rewriteSelection', () => {
    it('forwards only the request bridge payload and context', async () => {
      const service = buildService();
      const runtime = new PageAgentExecutionRuntime(service);
      const args = { instruction: 'Make it concise', requestId: 'request-1' };

      const result = await runtime.rewriteSelection(args, ctxWithDoc);

      expect(service.rewriteSelection).toHaveBeenCalledWith(args, ctxWithDoc);
      expect(result).toMatchObject({
        content: 'ok:rewriteSelection',
        state: { documentId: DOC_ID, ran: 'rewriteSelection' },
        success: true,
      });
    });
  });
});
