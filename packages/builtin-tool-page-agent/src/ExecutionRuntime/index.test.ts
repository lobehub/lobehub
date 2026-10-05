// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { PageAgentInvocationContext, PageAgentRuntimeService } from './index';
import { PageAgentExecutionRuntime } from './index';

const DOC_ID = 'doc_test_1';
const ctxWithDoc: PageAgentInvocationContext = { documentId: DOC_ID, userId: 'u1' };
const ctxNoDoc: PageAgentInvocationContext = { userId: 'u1' };

const buildService = (initPage?: PageAgentRuntimeService['initPage']): PageAgentRuntimeService => ({
  initPage: vi.fn(
    initPage ??
      (async () => ({
        content: 'initialized',
        state: { changed: true, nodeCount: 1, rootId: 'root' },
      })),
  ),
});

describe('PageAgentExecutionRuntime', () => {
  it('rejects a call without documentId and never reaches the service', async () => {
    const service = buildService();
    const runtime = new PageAgentExecutionRuntime(service);

    const result = await runtime.initPage({ markdown: '# Hi' }, ctxNoDoc);

    expect(result.success).toBe(false);
    expect((result.error as { type?: string }).type).toBe('PageAgentMissingDocumentId');
    expect(service.initPage).not.toHaveBeenCalled();
  });

  it('forwards initPage with context and envelopes the output with documentId', async () => {
    const service = buildService();
    const runtime = new PageAgentExecutionRuntime(service);

    const result = await runtime.initPage({ markdown: '# Hi' }, ctxWithDoc);

    expect(service.initPage).toHaveBeenCalledWith({ markdown: '# Hi' }, ctxWithDoc);
    expect(result).toMatchObject({ content: 'initialized', success: true });
    expect(result.state).toMatchObject({ changed: true, documentId: DOC_ID });
  });

  it('wraps thrown service errors as PageAgentRuntimeError', async () => {
    const runtime = new PageAgentExecutionRuntime(
      buildService(async () => {
        throw new Error('boom');
      }),
    );

    const result = await runtime.initPage({ markdown: '# Hi' }, ctxWithDoc);

    expect(result.success).toBe(false);
    expect(result.content).toBe('boom');
    expect((result.error as { type?: string }).type).toBe('PageAgentRuntimeError');
  });
});
