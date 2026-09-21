import type { ToolAfterCallContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { NotebookApiName } from '../types';
import { NotebookExecutor } from './index';

const afterCall = (
  apiName: string,
  result: ToolAfterCallContext['result'],
  topicId = 'topic-1',
): ToolAfterCallContext =>
  ({ apiName, identifier: 'lobe-notebook', params: {}, result, topicId }) as ToolAfterCallContext;

describe('NotebookExecutor.onAfterCall', () => {
  it('passes the updated document id and topic so the host revalidates the open editor', async () => {
    const onDocumentsMutated = vi.fn();
    const executor = new NotebookExecutor({} as never, { onDocumentsMutated });

    await executor.onAfterCall(
      afterCall(NotebookApiName.updateDocument, {
        state: { document: { id: 'doc-1' } },
        success: true,
      }),
    );

    expect(onDocumentsMutated).toHaveBeenCalledWith({ documentId: 'doc-1', topicId: 'topic-1' });
  });

  it.each([NotebookApiName.createDocument, NotebookApiName.deleteDocument])(
    'revalidates only the topic list for %s',
    async (apiName) => {
      const onDocumentsMutated = vi.fn();
      const executor = new NotebookExecutor({} as never, { onDocumentsMutated });

      await executor.onAfterCall(
        afterCall(apiName, { state: { document: { id: 'doc-1' } }, success: true }),
      );

      expect(onDocumentsMutated).toHaveBeenCalledWith({ topicId: 'topic-1' });
    },
  );

  it('ignores reads and failed writes', async () => {
    const onDocumentsMutated = vi.fn();
    const executor = new NotebookExecutor({} as never, { onDocumentsMutated });

    await executor.onAfterCall(
      afterCall(NotebookApiName.getDocument, {
        state: { document: { id: 'doc-1' } },
        success: true,
      }),
    );
    await executor.onAfterCall(afterCall(NotebookApiName.updateDocument, { success: false }));

    expect(onDocumentsMutated).not.toHaveBeenCalled();
  });
});
