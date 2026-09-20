import type { ToolAfterCallContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { AgentDocumentsExecutionRuntime } from '../ExecutionRuntime';
import { AgentDocumentsApiName } from '../types';
import { AgentDocumentsExecutor } from './index';

const makeExecutor = (onDocumentsMutated: () => void, onDocumentWritten?: () => void) => {
  // onAfterCall only reaches runtime.notifyMutated → options.onDocumentsMutated,
  // so the service methods are never touched here.
  const runtime = new AgentDocumentsExecutionRuntime({} as never, {
    onDocumentWritten,
    onDocumentsMutated,
  });
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

    expect(onDocumentsMutated).toHaveBeenCalledTimes(1);
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

  it('skips notification when the call failed', async () => {
    const onDocumentsMutated = vi.fn();
    const executor = makeExecutor(onDocumentsMutated);

    await executor.onAfterCall(ctx(AgentDocumentsApiName.createDocument, false));

    expect(onDocumentsMutated).not.toHaveBeenCalled();
  });

  it('skips notification for read-only / content-only calls that leave the list unchanged', async () => {
    const onDocumentsMutated = vi.fn();
    const executor = makeExecutor(onDocumentsMutated);

    await executor.onAfterCall(ctx(AgentDocumentsApiName.listDocuments, true));
    await executor.onAfterCall(ctx(AgentDocumentsApiName.replaceDocumentContent, true));

    expect(onDocumentsMutated).not.toHaveBeenCalled();
  });

  it('adopts a content write through onDocumentWritten so an open editor can drop pending autosaves', async () => {
    const onDocumentsMutated = vi.fn();
    const onDocumentWritten = vi.fn();
    const executor = makeExecutor(onDocumentsMutated, onDocumentWritten);

    await executor.onAfterCall({
      ...ctx(AgentDocumentsApiName.replaceDocumentContent, true),
      result: {
        state: {
          documentContent: '# Agent write',
          documentId: 'doc-1',
          documentTitle: 'Spec',
        },
        success: true,
      },
    });

    expect(onDocumentsMutated).not.toHaveBeenCalled();
    expect(onDocumentWritten).toHaveBeenCalledWith({
      content: '# Agent write',
      documentId: 'doc-1',
      editorData: undefined,
      title: 'Spec',
      updatedAt: undefined,
    });
  });
});
