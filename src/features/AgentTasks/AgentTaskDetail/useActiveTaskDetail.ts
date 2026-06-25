import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

interface ActiveTaskDetailState {
  /**
   * Hard loading gate: the first task snapshot isn't ready yet, OR it is but the
   * assignee agent's config (model / heterogeneous runtime) hasn't hydrated. The
   * detail surfaces depend on the assignee config to render the model picker
   * correctly, so we hold the skeleton until it lands.
   */
  isInitialLoading: boolean;
  /** The task fetch settled with an error and there is no cached detail. */
  isNotFound: boolean;
}

/**
 * Shared task-detail data wiring for every surface that shows a single task
 * (the full `/task/[tid]` page and the chat-side Portal). Owns `activeTaskId`
 * while mounted, drives the polling task fetch, and front-loads the assignee
 * agent's config into the agent store so model / heterogeneous-runtime reads
 * resolve against the *assignee* — not whatever agent happens to be active in
 * the surrounding chat. Returning only loading/not-found flags keeps each
 * surface free to own its own chrome.
 */
export const useActiveTaskDetail = (taskId?: string): ActiveTaskDetailState => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  const useHydrateAgentConfig = useAgentStore((s) => s.useHydrateAgentConfig);

  const hasTaskDetail = useTaskStore((s) => (taskId ? !!s.taskDetailMap[taskId] : false));
  // The assignee comes from the loaded task detail, so this stays undefined
  // until the first fetch resolves — which is exactly when its hydration kicks in.
  const assigneeAgentId = useTaskStore((s) =>
    taskId ? (s.taskDetailMap[taskId]?.agentId ?? undefined) : undefined,
  );
  const assigneeInMap = useAgentStore((s) => !!(assigneeAgentId && s.agentMap[assigneeAgentId]));

  useEffect(() => {
    if (!taskId) return;
    setActiveTaskId(taskId);
    return () => setActiveTaskId(undefined);
  }, [taskId, setActiveTaskId]);

  // `fetchTaskDetail` throws on a missing task, so `error` is the definitive
  // "settled and absent" signal — using it (instead of `!isLoading`) avoids the
  // first-paint flash where no fetch has run yet but the cache is still empty.
  const { error: taskError } = useFetchTaskDetail(taskId);

  // Hydrate-only (never touches `activeAgentId`); no-ops on an empty id, so it
  // simply activates once the assignee is known from the task detail.
  const { isLoading: agentConfigLoading } = useHydrateAgentConfig(isLogin, assigneeAgentId ?? '');

  if (!taskId) return { isInitialLoading: false, isNotFound: false };

  const isNotFound = !!taskError && !hasTaskDetail;
  // Anything that isn't "we have the detail" or "it's confirmed gone" is still
  // resolving — keep the skeleton up instead of flashing empty/404.
  const isTaskResolving = !hasTaskDetail && !isNotFound;

  // Block on the assignee config only while its fetch is genuinely in-flight and
  // we don't already have it cached. Gating on `isLoading` (not "absent from the
  // map") is what avoids the deadlock: a settled fetch that resolves to `null` —
  // the assignee was deleted or moved to another workspace, so the ownership-
  // scoped query returns null *without* erroring — leaves `isLoading=false` and
  // no error, releasing the gate instead of waiting forever for a config that
  // will never land in the map.
  const isAssigneeResolving =
    !!assigneeAgentId && isLogin === true && !assigneeInMap && agentConfigLoading;

  return {
    isInitialLoading: isTaskResolving || (hasTaskDetail && isAssigneeResolving),
    isNotFound,
  };
};
