import { isDesktop } from '@lobechat/const';
import { useEffect, useMemo, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { projectFileActions, projectIndexResource, useProjectFileStore } from '@/store/projectFile';

/**
 * How often the sandbox tree re-reads itself while an agent run is writing
 * into it. The listing asks the session to save its work tree before serving,
 * so a poll costs a walk of what changed — worth it while a run is producing
 * files, wasteful when nothing is happening, which is why it only runs then.
 */
const SANDBOX_LIVE_REFRESH_INTERVAL = 15 * 1000;

/**
 * Project file tree for a working directory, read from the project-index
 * replica: a reload paints the last tree for this host + directory, then the
 * host is asked again. Transport-agnostic: `projectFileService`
 * dispatches Electron IPC (local), `device.getProjectFileIndex` RPC (remote,
 * `deviceId` set), or the cloud sandbox's workspace API (`sandbox` set).
 *
 * Disabled until a directory is available — for the sandbox that is the
 * workspace root, which is the empty string, so its gate is the source rather
 * than the path. On web without either host there is nothing to read.
 */
export const useProjectFiles = (
  deviceId: string | undefined,
  dirPath: string | undefined,
  sandbox?: { instanceId?: string; live?: boolean; topicId?: string },
) => {
  const isSandbox = !!sandbox?.instanceId || !!sandbox?.topicId;
  const enabled = isSandbox ? dirPath !== undefined : Boolean(dirPath) && (!!deviceId || isDesktop);
  const params = useMemo(
    () =>
      enabled
        ? {
            deviceId,
            dirPath: dirPath!,
            sandboxInstanceId: sandbox?.instanceId,
            sandboxTopicId: sandbox?.topicId,
          }
        : null,
    [enabled, deviceId, dirPath, sandbox?.instanceId, sandbox?.topicId],
  );
  const data = useProjectFileStore((s) =>
    params ? s.projectIndex[projectIndexResource.key(params)] : undefined,
  );

  // The sandbox tree is a mirror of a directory nobody in this browser is
  // touching: the writer is the agent, on the other side of the network.
  // Refetching on focus alone means a user watching a run in progress sees a
  // tree from before it started, so a run is what makes this tree live.
  const isRunning = useChatStore(operationSelectors.isAgentRuntimeRunning);
  const live = isSandbox && isRunning && (sandbox?.live ?? true);

  const { error, isHydrated, isValidating, revalidate } = projectFileActions.useFetchProjectIndex(
    params,
    {
      focusThrottleInterval: 30 * 1000,
      refreshInterval: live ? SANDBOX_LIVE_REFRESH_INTERVAL : 0,
      // A hidden prefetch is one-shot: no polling and no focus re-walk for a
      // pane nobody is looking at.
      revalidateOnFocus: sandbox?.live ?? true,
      shouldRetryOnError: false,
    },
  );

  // The interval stops with the run, so the last writes of a turn can land in
  // the gap between the final poll and the end. One read on the way down is
  // what makes the tree agree with the answer the user is reading.
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) void revalidate();
    wasLive.current = live;
  }, [live, revalidate]);

  return {
    data,
    error,
    // Only a directory with nothing to show yet is loading: a saved tree is
    // shown as is while the host is asked again.
    isLoading: !!params && !data && !error && (!isHydrated || isValidating),
    isValidating,
    mutate: revalidate,
  };
};
