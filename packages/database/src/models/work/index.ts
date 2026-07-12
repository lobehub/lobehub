import type {
  DeleteDocumentWorkParams,
  DeleteTaskWorkParams,
  RegisterDocumentWorkParams,
  RegisterGithubWorkParams,
  RegisterLinearWorkParams,
  RegisterSkillToolResultWorkParams,
  RegisterTaskWorkParams,
  WorkItem,
} from '@lobechat/types';

import type { LobeChatDatabase } from '../../type';
import type { WorkContext } from './context';
import { registerDocumentWork } from './document';
import { registerGithubWork } from './github';
import { normalizeGithubToolResult } from './githubToolResult';
import { registerLinearWork } from './linear';
import { normalizeLinearToolResult } from './linearToolResult';
import * as queries from './queries';
import { registerTaskWork } from './task';
import * as writes from './writes';

/**
 * Facade over the per-type Work modules. Holds the `WorkContext` (db + owner
 * scope) and delegates each public method to a free function in the matching
 * module, keeping the polymorphic Work registry logic split by provider type
 * without changing the public API surface.
 */
export class WorkModel {
  private readonly ctx: WorkContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.ctx = { db, userId, workspaceId };
  }

  registerTask = (params: RegisterTaskWorkParams): Promise<WorkItem | null> =>
    registerTaskWork(this.ctx, params);

  registerDocument = (params: RegisterDocumentWorkParams): Promise<WorkItem | null> =>
    registerDocumentWork(this.ctx, params);

  registerLinear = (params: RegisterLinearWorkParams): Promise<WorkItem | null> =>
    registerLinearWork(this.ctx, params);

  registerGithub = (
    params: Omit<RegisterGithubWorkParams, 'resourceId'> & { resourceId: string },
  ): Promise<WorkItem | null> => registerGithubWork(this.ctx, params);

  handleSkillToolResult = async (
    params: RegisterSkillToolResultWorkParams,
  ): Promise<WorkItem | null> => {
    const { provider, ...rest } = params;

    switch (provider) {
      case 'github': {
        const operation = normalizeGithubToolResult(rest);
        if (!operation) return null;

        return this.registerGithub(operation.params);
      }

      case 'linear': {
        const operation = normalizeLinearToolResult(rest);
        if (!operation) return null;

        return this.registerLinear(operation.params);
      }

      default: {
        return null;
      }
    }
  };

  deleteDocumentWork = (params: DeleteDocumentWorkParams): Promise<void> =>
    writes.deleteDocumentWork(this.ctx, params);

  deleteTaskWork = (params: DeleteTaskWorkParams): Promise<void> =>
    writes.deleteTaskWork(this.ctx, params);

  listByRootOperation = (params: { limit?: number; rootOperationId?: string | null }) =>
    queries.listByRootOperation(this.ctx, params);

  listByRootOperations = (params: { limit?: number; rootOperationIds?: string[] | null }) =>
    queries.listByRootOperations(this.ctx, params);

  listSummariesByRootOperations = (params: {
    limit?: number;
    rootOperationIds?: string[] | null;
  }) => queries.listSummariesByRootOperations(this.ctx, params);

  listByConversation = (params: {
    limit?: number;
    threadId?: string | null;
    topicId?: string | null;
  }) => queries.listByConversation(this.ctx, params);

  listByWorkspace = (params: queries.ListByWorkspaceParams) =>
    queries.listByWorkspace(this.ctx, params);

  listVersions = (workId: string) => queries.listVersions(this.ctx, workId);
}
