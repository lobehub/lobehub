import type { ToolAfterCallContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { AgentDocumentsExecutionRuntime } from '../ExecutionRuntime';
import { AgentDocumentsApiName } from '../types';
import { AgentDocumentsExecutor } from './index';

const makeExecutor = (onDocumentsMutated: (params: { documentId?: string }) => void) => {
  // onAfterCall only reaches runtime.notifyMutated → options.onDocumentsMutated,
  // so the service methods are never touched here.
  const runtime = new AgentDocumentsExecutionRuntime({} as never, { onDocumentsMutated });
  return new AgentDocumentsExecutor(runtime);
};

const ctx = (apiName: string, success: boolean): ToolAfterCallContext =>
  ({
    apiName,
    identifier: 'lobe-agent-documents',
    params: {},
    result: { success },
    toolCallId: 'call_1',
  }) as ToolAfterCallContext;

describe('AgentDocumentsExecutor.onAfterCall', () => {
  it('notifies the host after a successful list-mutating call', async () => {
    const onDocumentsMutated = vi.fn();
    const executor = makeExecutor(onDocumentsMutated);

    await executor.onAfterCall(ctx(AgentDocumentsApiName.createDocument, true));

    expect(onDocumentsMutated).toHaveBeenCalledWith({ documentId: undefined });
  });

  it.each([
    AgentDocumentsApiName.removeDocument,
    AgentDocumentsApiName.renameDocument,
    AgentDocumentsApiName.copyDocument,
  ])('notifies for the %s mutation', async (apiName) => {
    const onDocumentsMutated = vi.fn();
    const executor = makeExecutor(onDocumentsMutated);

    await executor.onAfterCall(ctx(apiName, true));

    expect(onDocumentsMutated).toHaveBeenCalledTimes(1);
  });

  it.each([
    AgentDocumentsApiName.replaceDocumentContent,
    AgentDocumentsApiName.modifyNodes,
    AgentDocumentsApiName.renameDocument,
  ])('passes the written documentId for %s so the open editor revalidates', async (apiName) => {
    const onDocumentsMutated = vi.fn();
    const executor = makeExecutor(onDocumentsMutated);

    await executor.onAfterCall({
      ...ctx(apiName, true),
      result: { state: { documentId: 'doc-1' }, success: true },
    });

    expect(onDocumentsMutated).toHaveBeenCalledTimes(1);
    expect(onDocumentsMutated).toHaveBeenCalledWith({ documentId: 'doc-1' });
  });

  it.each([
    AgentDocumentsApiName.removeDocument,
    AgentDocumentsApiName.copyDocument,
    AgentDocumentsApiName.createDocument,
  ])(
    'drops the documentId for %s so a deleted or unopened row is never revalidated',
    async (apiName) => {
      const onDocumentsMutated = vi.fn();
      const executor = makeExecutor(onDocumentsMutated);

      await executor.onAfterCall({
        ...ctx(apiName, true),
        result: { state: { documentId: 'doc-1' }, success: true },
      });

      expect(onDocumentsMutated).toHaveBeenCalledWith({ documentId: undefined });
    },
  );

  it('skips notification when the call failed', async () => {
    const onDocumentsMutated = vi.fn();
    const executor = makeExecutor(onDocumentsMutated);

    await executor.onAfterCall(ctx(AgentDocumentsApiName.createDocument, false));

    expect(onDocumentsMutated).not.toHaveBeenCalled();
  });

  it('skips notification for read-only calls and content writes without a documentId', async () => {
    const onDocumentsMutated = vi.fn();
    const executor = makeExecutor(onDocumentsMutated);

    await executor.onAfterCall({
      ...ctx(AgentDocumentsApiName.readDocument, true),
      result: { state: { documentId: 'doc-1' }, success: true },
    });
    await executor.onAfterCall(ctx(AgentDocumentsApiName.listDocuments, true));
    await executor.onAfterCall(ctx(AgentDocumentsApiName.replaceDocumentContent, true));

    expect(onDocumentsMutated).not.toHaveBeenCalled();
  });
});
