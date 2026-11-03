import type { ToolHookContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatState, documentState, invalidateSpy } = vi.hoisted(() => ({
  chatState: { operations: {} as Record<string, any> },
  documentState: {
    beginAgentEdit: vi.fn(),
    documents: {} as Record<string, any>,
    endAgentEdit: vi.fn(),
  },
  invalidateSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/document/invalidation', () => ({
  invalidateDocumentMutation: invalidateSpy,
}));
vi.mock('@/store/chat', () => ({ useChatStore: { getState: () => chatState } }));
vi.mock('@/store/document', () => ({ useDocumentStore: { getState: () => documentState } }));

const { pageAgentHookExecutor, withPageEditHooks } = await import('./pageEdits');

const call = (overrides: Partial<ToolHookContext> = {}): ToolHookContext => ({
  apiName: 'runCommand',
  identifier: 'lobe-cloud-sandbox',
  params: { command: 'cat /mnt/page/doc.xml' },
  toolCallId: 'call_1',
  topicId: 'tpc_page',
  ...overrides,
});

const sandboxExecutor = {
  getApiNames: () => ['runCommand'],
  hasApi: () => true,
  identifier: 'lobe-cloud-sandbox',
  invoke: vi.fn(),
  onAfterCall: vi.fn(),
};

describe('page edit hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatState.operations = {
      op_1: {
        context: { documentId: 'doc_1', scope: 'page', topicId: 'tpc_page' },
        status: 'running',
      },
    };
    documentState.documents = { doc_1: { collab: false } };
  });

  it('holds a stored page read-only while a page command runs and reloads it after', async () => {
    const executor = withPageEditHooks(sandboxExecutor as any);

    await executor.onBeforeCall!(call());
    expect(documentState.beginAgentEdit).toHaveBeenCalledWith('doc_1');

    await executor.onAfterCall!({ ...call(), result: { success: true } } as any);
    expect(documentState.endAgentEdit).toHaveBeenCalledWith('doc_1');
    expect(invalidateSpy).toHaveBeenCalledWith({ cause: 'document-service', documentId: 'doc_1' });
  });

  it('keeps the executor own hooks', async () => {
    const executor = withPageEditHooks(sandboxExecutor as any);
    const ctx = { ...call(), result: { success: true } } as any;

    await executor.onAfterCall!(ctx);

    expect(sandboxExecutor.onAfterCall).toHaveBeenCalledWith(ctx);
  });

  it('leaves a page with a collaboration room alone', async () => {
    documentState.documents.doc_1.collab = true;

    await withPageEditHooks(sandboxExecutor as any).onBeforeCall!(call());

    expect(documentState.beginAgentEdit).not.toHaveBeenCalled();
  });

  it('ignores background commands, which never sync the page', async () => {
    await withPageEditHooks(sandboxExecutor as any).onBeforeCall!(
      call({ params: { background: true, command: 'sleep 60' } }),
    );

    expect(documentState.beginAgentEdit).not.toHaveBeenCalled();
  });

  it('ignores calls of runs outside the page scope', async () => {
    await withPageEditHooks(sandboxExecutor as any).onBeforeCall!(call({ topicId: 'tpc_other' }));

    expect(documentState.beginAgentEdit).not.toHaveBeenCalled();
  });

  it('ignores sandbox APIs that do not sync the page', async () => {
    await withPageEditHooks(sandboxExecutor as any).onBeforeCall!(call({ apiName: 'readFile' }));

    expect(documentState.beginAgentEdit).not.toHaveBeenCalled();
  });

  it('tracks the page agent full rewrite through its hook-only executor', async () => {
    await pageAgentHookExecutor.onBeforeCall!(
      call({ apiName: 'initPage', identifier: 'lobe-page-agent' }),
    );

    expect(documentState.beginAgentEdit).toHaveBeenCalledWith('doc_1');
    expect(pageAgentHookExecutor.hasApi('initPage')).toBe(false);
  });
});
