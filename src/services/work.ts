import { TaskApiName, TaskIdentifier } from '@lobechat/builtin-tool-task';
import type {
  ListedWorkType,
  RegisterCanvasWorkParams,
  RegisterDocumentWorkParams,
  RegisterSkillToolResultWorkParams,
  RegisterTaskWorkParams,
  WorkItem,
  WorkListItem,
  WorkSkillProvider,
  WorkSummaryItem,
  WorkVersionEventItem,
  WorkVersionEventMap,
  WorkVersionItem,
  WorkVisibility,
} from '@lobechat/types';

import { mutate } from '@/libs/swr';
import { matchDomain, workKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { revalidateConversationMessages } from '@/services/message/replica';

/** One cursor page of the workspace-wide Work list (resource page 产物 gallery). */
export interface WorkSummaryPage {
  items: WorkSummaryItem[];
  nextCursor: string | null;
}

const TASK_WORK_VIEW_MUTATIONS = new Set<string>([
  TaskApiName.runTask,
  TaskApiName.runTasks,
  TaskApiName.updateTaskStatus,
]);

export const didToolMutateWorkView = ({
  apiName,
  identifier,
  result,
  succeeded,
  workRegistration,
}: {
  apiName?: string;
  identifier?: string;
  result?: { state?: unknown };
  succeeded: boolean;
  workRegistration: boolean;
}): boolean => {
  if (workRegistration) return true;
  if (identifier !== TaskIdentifier || !apiName || !TASK_WORK_VIEW_MUTATIONS.has(apiName)) {
    return false;
  }

  if (apiName === TaskApiName.runTasks) {
    const succeededCount = (result?.state as { succeeded?: unknown } | undefined)?.succeeded;
    return typeof succeededCount === 'number' ? succeededCount > 0 : true;
  }

  return succeeded;
};

class WorkService {
  // This client ships the descriptor fallback for every registered Work type, so
  // it always opts into the `file` type (and any future gated type). The flag is
  // set here at the service boundary rather than per call site — an
  // already-deployed client that predates the `file` type runs the old service
  // without it and stays on the legacy set. See resolveAllowedWorkTypes.
  listByConversation = async (params: {
    limit?: number;
    threadId?: string | null;
    topicId?: string | null;
  }): Promise<WorkListItem[]> =>
    lambdaClient.work.listByConversation.query({ ...params, includeFileWorks: true });

  listByWorkspace = async (params: {
    cursor?: string | null;
    limit?: number;
    originAgentId?: string | null;
    provider?: WorkSkillProvider;
    type?: ListedWorkType | null;
    visibility?: WorkVisibility;
  }): Promise<WorkSummaryPage> =>
    lambdaClient.work.listByWorkspace.query({ ...params, includeFileWorks: true });

  listByRootOperation = async (params: {
    limit?: number;
    rootOperationId?: string | null;
  }): Promise<WorkVersionEventItem[]> =>
    lambdaClient.work.listByRootOperation.query({ ...params, includeFileWorks: true });

  listByRootOperations = async (params: {
    limit?: number;
    rootOperationIds?: string[] | null;
  }): Promise<WorkVersionEventMap> =>
    lambdaClient.work.listByRootOperations.query({ ...params, includeFileWorks: true });

  listVersions = async (workId: string): Promise<WorkVersionItem[]> =>
    lambdaClient.work.listVersions.query({ workId });

  registerTask = async (params: RegisterTaskWorkParams): Promise<WorkItem | null> =>
    lambdaClient.work.registerTask.mutate(params);

  registerCanvas = async (params: RegisterCanvasWorkParams): Promise<WorkItem> =>
    lambdaClient.work.registerCanvas.mutate(params);

  registerDocument = async (params: RegisterDocumentWorkParams): Promise<WorkItem | null> =>
    lambdaClient.work.registerDocument.mutate(params);

  deleteTaskWork = async (params: { taskId: string }): Promise<void> =>
    lambdaClient.work.deleteTaskWork.mutate(params);

  /** Remove one Work card by id (see `useRemoveWork`); server-side restricted to the caller's own rows. */
  deleteWork = async (id: string): Promise<void> => lambdaClient.work.deleteWork.mutate({ id });

  handleSkillToolResult = async (
    params: RegisterSkillToolResultWorkParams,
  ): Promise<WorkItem | null> => lambdaClient.work.handleSkillToolResult.mutate(params);

  /**
   * Report a finished desktop-LOCAL hetero run's tool messages for the
   * server-side shell Work scan (gh CLI → github Work cards). Local runs have
   * no `agent_operations` row, so the server's completion scan never fires for
   * them — the executor calls this at clean completion instead.
   */
  registerShellWorksForRun = async (params: {
    anchorMessageId: string;
    messageIds: string[];
    topicId: string;
  }): Promise<{ failed: number; registered: number; rootOperationId: string | null }> =>
    lambdaClient.work.registerShellWorksForRun.mutate(params);

  /**
   * Invalidate everything a Work mutation can change for a conversation:
   * - the topic's transcript syncs, since Work summaries (in-message chips
   *   and the sidebar summary view) ride the message payload
   * - the sidebar history and expanded version views
   */
  refreshConversation = async (topicId?: string | null, threadId?: string | null) => {
    if (!topicId) return;
    await Promise.all([
      this.refreshConversationMessages(topicId),
      this.refreshConversationViews(topicId, threadId),
    ]);
  };

  /**
   * Re-pull the message list for a topic so the Work summaries attached to its
   * message payload become fresh. Only mounted syncs refetch, so this is a
   * no-op when the topic isn't the active conversation.
   */
  refreshConversationMessages = async (topicId: string) => {
    await revalidateConversationMessages((context) => context.topicId === topicId);
  };

  refreshAll = async () => {
    await this.#collapseWorkspaceTails();
    await mutate(matchDomain('work:'));
  };

  /**
   * Revalidate every mounted workspace Work list (the gallery filters and the
   * project dashboards). Their replicas sync through `work:workspace` keys.
   */
  refreshWorkspaceLists = async () => {
    await this.#collapseWorkspaceTails();
    await mutate((key) => Array.isArray(key) && key[0] === workKeys.workspace.root);
  };

  /**
   * The gallery replica only re-requests its head page, so loaded tail pages
   * are dropped first rather than left stale. Imported on demand: the work
   * store depends on this service.
   */
  #collapseWorkspaceTails = async () => {
    const { workActions } = await import('@/store/work');
    workActions.collapseWorkspaceWorksTails();
  };

  /**
   * Refresh only the sidebar's *lazy* Work caches for a conversation — the
   * history list ({@link workKeys.conversation}) and any expanded version
   * timelines ({@link workKeys.versions}). Deliberately narrower than
   * {@link refreshAll}: it never touches the message payload (Work
   * summaries ride the message list and are refreshed by the message fetch
   * itself) nor the cross-topic workspace gallery (`work:workspace`).
   *
   * Called once per agent run at operation end by the runtime transports
   * (gateway: `agent_runtime_end`; client runtime: the afterCompletion callback
   * via {@link refreshConversation}) instead of on every tool_end — these lazy
   * views are an operation-grained concern, so a single settle-time refresh
   * replaces the per-tool `work.listByConversation` flood. WorksSection only
   * calls it for Work changes made outside a run (e.g. a manual delete).
   * `mutate` only revalidates mounted keys, so this is a no-op when the
   * sidebar is collapsed or showing the summary view.
   */
  refreshConversationViews = async (topicId?: string | null, threadId?: string | null) => {
    if (!topicId) return;
    await Promise.all([
      mutate(workKeys.conversation(topicId, threadId ?? null)),
      mutate((key) => Array.isArray(key) && key[0] === workKeys.versions.root),
    ]);
  };

  /**
   * Broad invalidation for Work mutations without a single-topic scope (e.g.
   * task deletion, which can orphan Works across topics into a "task deleted"
   * state). Refreshes every mounted transcript sync — since Work summaries ride
   * the message payload — plus the whole work domain for the sidebar caches.
   */
  refreshAllConversations = async () => {
    await Promise.all([revalidateConversationMessages(), this.refreshAll()]);
  };

  refreshVersions = async (workId?: string | null) => {
    if (!workId) return;
    await mutate(workKeys.versions(workId));
  };
}

export const workService = new WorkService();
