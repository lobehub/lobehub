import {
  type AgentWorkRunContext,
  type ArtboardWorkPublishMetadata,
  type CanvasWorkPublishMetadata,
  type CreateAgentWorkInput,
  type DeleteDocumentWorkParams,
  type DeleteTaskWorkParams,
  type DeleteWorkParams,
  isWorkSkillProvider,
  type RegisterArtboardWorkParams,
  type RegisterCanvasWorkParams,
  type RegisterDocumentWorkParams,
  type RegisterExternalWorkParams,
  type RegisterFileWorkParams,
  type RegisterSkillToolResultWorkParams,
  type RegisterTaskWorkParams,
  type SkillToolResultWorkInput,
  type UpdateAgentWorkInput,
  type WorkAccessScope,
  type WorkItem,
  type WorkSkillProvider,
  type WorkType,
  type WorkVisibility,
} from '@lobechat/types';
import debug from 'debug';

import type { LobeChatDatabase } from '../../type';
import { ScmChangeRequestModel } from '../scm';
import { createAgentWork, deleteAgentWork, fillAgentWorkCost, updateAgentWork } from './agentWork';
import {
  clearArtboardPublish,
  clearArtboardPublishForTrash,
  deleteArtboardWorksForTrash,
  findArtboardIdsByDeploymentIds,
  findArtboardWork,
  findArtboardWorkByWorkId,
  findArtboardWorksForTrash,
  recordArtboardPublish,
  registerArtboardWork,
} from './artboard';
import { registerShellArtboardResult } from './artboardShellResult';
import {
  findCanvasIdByWorkId,
  findCanvasIdsByDeploymentIds,
  findCanvasSourcesByVersionIds,
  findCanvasVersionId,
  findCanvasWork,
  findCanvasWorkVersion,
  findCanvasWorkVersionByToolCall,
  findReferencedCanvasManifestKeys,
  listCanvasWorks,
  recordCanvasPublish,
  registerCanvasWork,
} from './canvas';
import { resolveWorkAccessScope, type WorkContext } from './context';
import { registerDocumentWork } from './document';
import { registerExternalWork } from './external';
import { findFileWorkVersionByToolCall, registerFileWork } from './file';
import {
  type GithubShellNormalizeOptions,
  normalizeGithubShellToolResult,
  normalizeGithubToolResult,
} from './githubToolResult';
import {
  findLatestGoalReportVersion,
  registerGoalReportWork,
  type RegisterGoalReportWorkParams,
} from './goalReport';
import { normalizeLinearToolResult } from './linearToolResult';
import {
  listTopicPullRequests,
  listTopicsByPullRequest,
  listTopicsPullRequests,
} from './pullRequests';
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

const log = debug('lobe-database:work-model');

/**
 * Facade over the per-type Work modules. Holds the `WorkContext` (db + owner
 * scope) and delegates each public method to a free function in the matching
 * module, keeping the polymorphic Work registry logic split by provider type
 * without changing the public API surface.
 */
export { AgentWorkError, type AgentWorkErrorCode } from './agentWork';
export type { GithubShellNormalizeOptions } from './githubToolResult';
export { type GitPushResult, parseGithubRemoteUrl, parseGitPushResult } from './gitPushResult';

export class WorkModel {
  private readonly ctx: WorkContext;

  /**
   * @param accessScope - Agent Share boundary; defaults to the ordinary
   * (creator-facing) scope. Share-runtime callers pass
   * `agentShareWorkAccessScope(...)` so registration stamps provenance and
   * reads stay confined to that visitor topic.
   */
  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    accessScope?: WorkAccessScope,
  ) {
    this.ctx = { accessScope, db, userId, workspaceId };
  }

  registerTask = (params: RegisterTaskWorkParams): Promise<WorkItem | null> =>
    registerTaskWork(this.ctx, params);

  registerDocument = (params: RegisterDocumentWorkParams): Promise<WorkItem | null> =>
    registerDocumentWork(this.ctx, params);

  registerExternal = async (params: RegisterExternalWorkParams): Promise<WorkItem | null> => {
    const work = await registerExternalWork(this.ctx, params);

    // A pull-request Work is also a link the provider row resolves from.
    // `pull_request` deliveries only re-resolve when the next one arrives, so
    // a Work registered after the last one leaves the row linkless — and a
    // review or a failing check in between finds no conversation to wake.
    if (work && params.resourceType === 'github_pull_request') {
      await this.backfillChangeRequest(work, params.topicId).catch((error) =>
        log('change-request backfill for %s failed: %O', work.resourceId, error),
      );
    }

    return work;
  };

  registerFile = (params: RegisterFileWorkParams): Promise<WorkItem> =>
    registerFileWork(this.ctx, params);

  registerArtboard = (params: RegisterArtboardWorkParams): Promise<WorkItem> =>
    registerArtboardWork(this.ctx, params);

  findArtboardWork = (artboardId: string) => findArtboardWork(this.ctx, artboardId);

  findArtboardWorkByWorkId = (workId: string) => findArtboardWorkByWorkId(this.ctx, workId);

  recordArtboardPublish = (
    artboardId: string,
    params: ArtboardWorkPublishMetadata & { url: string },
  ): Promise<WorkItem | null> => recordArtboardPublish(this.ctx, artboardId, params);

  clearArtboardPublish = (artboardId: string): Promise<WorkItem | null> =>
    clearArtboardPublish(this.ctx, artboardId);

  findArtboardIdsByDeploymentIds = (deploymentIds: string[]) =>
    findArtboardIdsByDeploymentIds(this.ctx, deploymentIds);

  findArtboardWorksForTrash = (artboardIds: string[]) =>
    findArtboardWorksForTrash(this.ctx, artboardIds);

  clearArtboardPublishForTrash = (artboardIds: string[]) =>
    clearArtboardPublishForTrash(this.ctx, artboardIds);

  deleteArtboardWorksForTrash = (artboardIds: string[]) =>
    deleteArtboardWorksForTrash(this.ctx, artboardIds);

  registerCanvas = (params: RegisterCanvasWorkParams): Promise<WorkItem> =>
    registerCanvasWork(this.ctx, params);

  findCanvas = (canvasId: string) => findCanvasWork(this.ctx, canvasId);

  findCanvasIdByWorkId = (workId: string) => findCanvasIdByWorkId(this.ctx, workId);

  findCanvasVersionId = (canvasId: string, version: number) =>
    findCanvasVersionId(this.ctx, canvasId, version);

  findCanvasSourcesByVersionIds = (versionIds: string[]) =>
    findCanvasSourcesByVersionIds(this.ctx, versionIds);

  findCanvasIdsByDeploymentIds = (deploymentIds: string[]) =>
    findCanvasIdsByDeploymentIds(this.ctx, deploymentIds);

  recordCanvasPublish = (
    canvasId: string,
    params: CanvasWorkPublishMetadata & { url: string },
  ): Promise<WorkItem | null> => recordCanvasPublish(this.ctx, canvasId, params);

  findCanvasVersion = (workId: string, version: number) =>
    findCanvasWorkVersion(this.ctx, workId, version);

  findCanvasVersionByToolCall = (canvasId: string, toolCallId: string) =>
    findCanvasWorkVersionByToolCall(this.ctx, canvasId, toolCallId);

  findReferencedCanvasManifestKeys = (keys: string[]) =>
    findReferencedCanvasManifestKeys(this.ctx, keys);

  listCanvases = (params: { agentId?: string | null; limit?: number }) =>
    listCanvasWorks(this.ctx, params);

  registerGoalReport = (params: RegisterGoalReportWorkParams): Promise<WorkItem> =>
    registerGoalReportWork(this.ctx, params);

  findLatestGoalReport = (goalId: string) => findLatestGoalReportVersion(this.ctx, goalId);

  /**
   * Existence probe for a file Work's one-version-per-operation dedup key, so
   * the server consumer can skip a redundant export/upload on a retry. See
   * {@link findFileWorkVersionByToolCall}.
   */
  findFileVersionByToolCall = (params: {
    filePath: string;
    toolCallId: string;
    topicId: string;
    userId: string;
  }): Promise<{ id: string } | null> => findFileWorkVersionByToolCall(this.ctx, params);

  /** `lh work create` / `lobe-work`: register a file, link or collection the agent produced. See {@link createAgentWork}. */
  createAgentWork = (run: AgentWorkRunContext, input: CreateAgentWorkInput) =>
    createAgentWork(this.ctx, run, input);

  /** `lh work update`: add a version to an agent-created Work. See {@link updateAgentWork}. */
  updateAgentWork = (run: AgentWorkRunContext, input: UpdateAgentWorkInput) =>
    updateAgentWork(this.ctx, run, input);

  /** `lh work delete`: remove a Work the agent created by mistake. See {@link deleteAgentWork}. */
  deleteAgentWork = (run: AgentWorkRunContext, workId: string) =>
    deleteAgentWork(this.ctx, run, workId);

  /** Run completion: give the run's agent-written versions its spend. See {@link fillAgentWorkCost}. */
  fillAgentWorkCost = (params: Parameters<typeof fillAgentWorkCost>[1]) =>
    fillAgentWorkCost(this.ctx, params);

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

  /**
   * Register a github Work from a heterogeneous / device SHELL tool result
   * (codex `command_execution`, claude-code `Bash`, lobe-local-system
   * `runCommand`) that ran `gh issue|pr create/edit`. Unlike
   * {@link handleSkillToolResult} the version keeps the REAL producing tool as
   * its identifier (codex / claude-code / …) instead of a skill provider —
   * the github identity still lands on the same `owner/repo#number` Work row,
   * so both surfaces dedupe together.
   */
  registerShellGithubResult = async (
    params: SkillToolResultWorkInput & { toolIdentifier: string },
    options?: GithubShellNormalizeOptions,
  ): Promise<WorkItem | null> => {
    const { toolIdentifier, ...rest } = params;

    const operation = normalizeGithubShellToolResult(rest, options);
    if (!operation) return null;

    return this.registerExternal({ ...operation.params, toolIdentifier });
  };

  registerShellArtboardResult = (
    params: SkillToolResultWorkInput & { toolIdentifier: string },
  ): Promise<WorkItem | null> => registerShellArtboardResult(this.ctx, params);

  /**
   * Hand a just-registered `github_pull_request` Work to the provider row,
   * when one exists in the Work's own scope. Share-visitor registrations stay
   * out: their Works are fenced off from the creator's surfaces and must not
   * steer the owner's automation.
   */
  private backfillChangeRequest = async (
    work: WorkItem,
    topicId?: string | null,
  ): Promise<void> => {
    if (resolveWorkAccessScope(this.ctx).type === 'agentShare' || !work.resourceId) return;

    const separator = work.resourceId.lastIndexOf('#');
    const number = Number(work.resourceId.slice(separator + 1));
    if (separator <= 0 || !Number.isInteger(number)) return;

    await ScmChangeRequestModel.attachPullRequestWork(this.ctx.db, {
      number,
      repoFullName: work.resourceId.slice(0, separator),
      scope: { userId: this.ctx.userId, workspaceId: this.ctx.workspaceId ?? null },
      topicId: work.originTopicId ?? topicId,
      workId: work.id,
    });
  };

  deleteDocumentWork = (params: DeleteDocumentWorkParams): Promise<void> =>
    writes.deleteDocumentWork(this.ctx, params);

  deleteTaskWork = (params: DeleteTaskWorkParams): Promise<void> =>
    writes.deleteTaskWork(this.ctx, params);

  deleteWork = (params: DeleteWorkParams) => writes.deleteWork(this.ctx, params);

  /** See {@link writes.reassignTaskWorksOwner}. */
  reassignTaskWorksOwner = (taskIds: string[], fromUserId: string): Promise<void> =>
    writes.reassignTaskWorksOwner(this.ctx, taskIds, fromUserId);

  /** See {@link writes.setTaskWorksVisibility}. */
  setTaskWorksVisibility = (taskIds: string[], visibility: WorkVisibility): Promise<void> =>
    writes.setTaskWorksVisibility(this.ctx, taskIds, visibility);

  listByRootOperation = (params: {
    includeArtboardWorks?: boolean;
    includeFileWorks?: boolean;
    limit?: number;
    rootOperationId?: string | null;
  }) => queries.listByRootOperation(this.ctx, params);

  listByRootOperations = (params: {
    includeArtboardWorks?: boolean;
    includeFileWorks?: boolean;
    limit?: number;
    rootOperationIds?: string[] | null;
  }) => queries.listByRootOperations(this.ctx, params);

  /** See {@link queries.listSummariesByIds}. */
  listSummariesByIds = (workIds: string[]) => queries.listSummariesByIds(this.ctx, workIds);

  listSummariesByRootOperations = (params: {
    includeArtboardWorks?: boolean;
    includeFileWorks?: boolean;
    limit?: number;
    rootOperationIds?: string[] | null;
    /** See {@link queries.listSummariesByRootOperations}: narrows the types the caller draws. */
    types?: WorkType[];
  }) => queries.listSummariesByRootOperations(this.ctx, params);

  listByConversation = (params: {
    includeArtboardWorks?: boolean;
    includeFileWorks?: boolean;
    limit?: number;
    threadId?: string | null;
    topicId?: string | null;
  }) => queries.listByConversation(this.ctx, params);

  listByWorkspace = (params: queries.ListByWorkspaceParams) =>
    queries.listByWorkspace(this.ctx, params);

  listVersions = (workId: string) => queries.listVersions(this.ctx, workId);

  /** See {@link listTopicPullRequests}. */
  listTopicPullRequests = (topicId: string) => listTopicPullRequests(this.ctx, topicId);

  listTopicsByPullRequest = (identifier: string) => listTopicsByPullRequest(this.ctx, identifier);

  /** See {@link listTopicsPullRequests}. */
  listTopicsPullRequests = (topicIds: string[]) => listTopicsPullRequests(this.ctx, topicIds);
}
