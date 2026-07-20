import {
  type DeleteDocumentWorkParams,
  type DeleteTaskWorkParams,
  isWorkSkillProvider,
  type RegisterDocumentWorkParams,
  type RegisterExternalWorkParams,
  type RegisterSkillToolResultWorkParams,
  type RegisterTaskWorkParams,
  type SkillToolResultWorkInput,
  type WorkItem,
  type WorkSkillProvider,
} from '@lobechat/types';

import type { LobeChatDatabase } from '../../type';
import type { WorkContext } from './context';
import { registerDocumentWork } from './document';
import { registerExternalWork } from './external';
import { normalizeGithubToolResult } from './githubToolResult';
import { normalizeLinearToolResult } from './linearToolResult';
import * as queries from './queries';
import { registerTaskWork } from './task';
import type { ExternalToolWorkOperation } from './toolResultParsing';
import * as writes from './writes';

/**
 * Skill provider → tool-result normalizer. Keyed by `WorkSkillProvider`, so the
 * `satisfies` turns a provider added to `WORK_SKILL_PROVIDERS` without a
 * normalizer here into a compile error. Adding a provider = extend
 * `WORK_SKILL_PROVIDERS` + `WORK_PROVIDER_RESOURCE_TYPES` + one entry here.
 */
const SKILL_TOOL_RESULT_NORMALIZERS = {
  github: normalizeGithubToolResult,
  linear: normalizeLinearToolResult,
} satisfies Record<
  WorkSkillProvider,
  (input: SkillToolResultWorkInput) => ExternalToolWorkOperation | null
>;

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

  registerExternal = (params: RegisterExternalWorkParams): Promise<WorkItem | null> =>
    registerExternalWork(this.ctx, params);

  handleSkillToolResult = async (
    params: RegisterSkillToolResultWorkParams,
  ): Promise<WorkItem | null> => {
    const { provider, ...rest } = params;
    if (!isWorkSkillProvider(provider)) return null;

    const operation = SKILL_TOOL_RESULT_NORMALIZERS[provider](rest);
    if (!operation) return null;

    // The skill provider is the producing tool identifier (github / linear);
    // the DB layer stamps it here rather than plumbing it through transports.
    return this.registerExternal({ ...operation.params, toolIdentifier: provider });
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
