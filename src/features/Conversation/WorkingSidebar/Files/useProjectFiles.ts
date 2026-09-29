import { isDesktop } from '@lobechat/const';
import type { ProjectFileIndexResult } from '@lobechat/electron-client-ipc';
import { useEffect, useRef } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { localFileKeys } from '@/libs/swr/keys';
import { projectFileService } from '@/services/projectFile';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

/**
 * How often the sandbox tree re-reads itself while an agent run is writing
 * into it. The listing asks the session to save its work tree before serving,
 * so a poll costs a walk of what changed — worth it while a run is producing
 * files, wasteful when nothing is happening, which is why it only runs then.
 */
const SANDBOX_LIVE_REFRESH_INTERVAL = 15 * 1000;

/**
 * Project file tree for a working directory. Transport-agnostic: `fileService`
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
  sandbox?: { instanceId?: string; topicId?: string },
) => {
  const isSandbox = !!sandbox?.instanceId || !!sandbox?.topicId;
  const enabled = isSandbox ? dirPath !== undefined : Boolean(dirPath) && (!!deviceId || isDesktop);
  // The host is part of the identity: the same path on a device and in the
  // sandbox are different trees, and `undefined` already means "this machine".
  // Keyed by the INSTANCE where there is one — two conversations running the
  // same instance are looking at one tree, and keying by topic would fetch it
  // twice and let one go stale while the other refreshed.
  const host = isSandbox ? `sandbox:${sandbox?.instanceId ?? sandbox?.topicId}` : deviceId;
  const key = enabled ? localFileKeys.projectIndex(host, dirPath!) : null;

  // The sandbox tree is a mirror of a directory nobody in this browser is
  // touching: the writer is the agent, on the other side of the network.
  // Refetching on focus alone means a user watching a run in progress sees a
  // tree from before it started, so a run is what makes this tree live.
  const isRunning = useChatStore(operationSelectors.isAgentRuntimeRunning);
  const live = isSandbox && isRunning;

  const swr = useClientDataSWR<ProjectFileIndexResult | undefined>(
    key,
    () =>
      projectFileService.getProjectFileIndex({
        deviceId,
        sandboxInstanceId: sandbox?.instanceId,
        sandboxTopicId: sandbox?.topicId,
        scope: dirPath!,
      }),
    {
      focusThrottleInterval: 30 * 1000,
      refreshInterval: live ? SANDBOX_LIVE_REFRESH_INTERVAL : 0,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );

  // The interval stops with the run, so the last writes of a turn can land in
  // the gap between the final poll and the end. One read on the way down is
  // what makes the tree agree with the answer the user is reading.
  const { mutate } = swr;
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) mutate();
    wasLive.current = live;
  }, [live, mutate]);

  return swr;
};
