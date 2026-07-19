import { TaskApiName, TaskIdentifier } from '@lobechat/builtin-tool-task';
import type {
  RegisterDocumentWorkParams,
  RegisterSkillToolResultWorkParams,
  RegisterTaskWorkParams,
  WorkItem,
  WorkListItem,
  WorkSkillProvider,
  WorkSummaryItem,
  WorkType,
  WorkVersionEventItem,
  WorkVersionEventMap,
  WorkVersionItem,
} from '@lobechat/types';

import { mutate } from '@/libs/swr';
import { isMessageListKey, matchDomain, workKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

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
  listByConversation = async (params: {
    limit?: number;
    threadId?: string | null;
    topicId?: string | null;
  }): Promise<WorkListItem[]> => lambdaClient.work.listByConversation.query(params);

  listByWorkspace = async (params: {
    cursor?: string | null;
    limit?: number;
    provider?: WorkSkillProvider;
    type?: WorkType | null;
  }): Promise<WorkSummaryPage> => lambdaClient.work.listByWorkspace.query(params);

  listByRootOperation = async (params: {
    limit?: number;
    rootOperationId?: string | null;
  }): Promise<WorkVersionEventItem[]> => lambdaClient.work.listByRootOperation.query(params);

  listByRootOperations = async (params: {
    limit?: number;
    rootOperationIds?: string[] | null;
  }): Promise<WorkVersionEventMap> => lambdaClient.work.listByRootOperations.query(params);

  listVersions = async (workId: string): Promise<WorkVersionItem[]> =>
    lambdaClient.work.listVersions.query({ workId });

  registerTask = async (params: RegisterTaskWorkParams): Promise<WorkItem | null> =>
    lambdaClient.work.registerTask.mutate(params);

  registerDocument = async (params: RegisterDocumentWorkParams): Promise<WorkItem | null> =>
    lambdaClient.work.registerDocument.mutate(params);

  deleteTaskWork = async (params: { taskId: string }): Promise<void> =>
    lambdaClient.work.deleteTaskWork.mutate(params);

  handleSkillToolResult = async (
    params: RegisterSkillToolResultWorkParams,
  ): Promise<WorkItem | null> => lambdaClient.work.handleSkillToolResult.mutate(params);

  /**
   * Invalidate everything a Work mutation can change for a conversation:
   * - the topic's `message:list` entries, since Work summaries (in-message chips
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
   * message payload become fresh. `mutate` only refetches mounted keys, so this
   * is a no-op when the topic isn't the active conversation.
   */
  refreshConversationMessages = async (topicId: string) => {
    await mutate((key) => isMessageListKey(key, (context) => context.topicId === topicId));
  };

  refreshAll = async () => {
    await mutate(matchDomain('work:'));
  };

  /**
   * Refresh only the sidebar's *lazy* Work caches for a conversation — the
   * history list ({@link workKeys.conversation}) and any expanded version
   * timelines ({@link workKeys.versions}). Deliberately narrower than
   * {@link refreshAll}: it never touches the `message:list` payload (Work
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
   * state). Refreshes every mounted `message:list` — since Work summaries ride
   * the message payload — plus the whole work domain for the sidebar caches.
   */
  refreshAllConversations = async () => {
    await Promise.all([mutate((key) => isMessageListKey(key)), this.refreshAll()]);
  };

  refreshVersions = async (workId?: string | null) => {
    if (!workId) return;
    await mutate(workKeys.versions(workId));
  };
}

export const workService = new WorkService();
