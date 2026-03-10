import { NotebookIdentifier } from '@lobechat/builtin-tool-notebook';
import { NotebookExecutionRuntime } from '@lobechat/builtin-tool-notebook/executionRuntime';

import { NotebookRuntimeService } from '@/server/services/notebook';

import { type ServerRuntimeRegistration } from './types';

/**
 * Notebook Server Runtime
 * Per-request runtime (needs serverDB, userId, topicId)
 */
export const notebookRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Notebook execution');
    }

    const notebookService = new NotebookRuntimeService({
      serverDB: context.serverDB,
      userId: context.userId,
    });

    return new NotebookExecutionRuntime(notebookService);
  },
  identifier: NotebookIdentifier,
};
