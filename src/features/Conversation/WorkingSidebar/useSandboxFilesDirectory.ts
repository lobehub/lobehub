import useSWR from 'swr';

import {
  isPersistentSelection,
  useSandboxPlacement,
} from '@/features/ChatInput/ControlBar/useSandboxPlacement';
import { sandboxStorageService } from '@/services/sandboxStorage';

/**
 * Which directory on the drive a cloud-sandbox conversation's file tree shows.
 *
 * Only when the run actually keeps files: a temporary sandbox keeps nothing,
 * and pointing the panel at the drive would let another conversation's files
 * read as this one's. Read through the same hook the composer writes with, so
 * the panel sees a choice the moment it is made — including one buffered on
 * the agent before the conversation exists.
 *
 * `directory` is relative to the drive's root, where `''` IS the root (a
 * folder picked as `.`). An environment directory has to be looked up first,
 * and until it is `directoryKnown` is false — the empty string would otherwise
 * read as "the whole drive" and the tree would list every folder on it for as
 * long as the lookup took.
 */
export const useSandboxFilesDirectory = (
  agentId: string,
  { isSandboxTarget, topicId }: { isSandboxTarget: boolean; topicId?: string | null },
) => {
  const { selection } = useSandboxPlacement(agentId);
  const instanceId = selection.instanceId;
  const active = isSandboxTarget && isPersistentSelection(selection);

  const { data: instance } = useSWR(
    active && instanceId ? ['sandbox-instance-dir', instanceId] : null,
    () => sandboxStorageService.getInstance({ id: instanceId! }),
  );

  const directory = instanceId
    ? (instance?.workingDirectory ?? '')
    : selection.workingDirectory && selection.workingDirectory !== '.'
      ? selection.workingDirectory
      : '';

  return {
    active,
    directory,
    directoryKnown: !instanceId || instance !== undefined,
    instanceId: active ? instanceId : undefined,
    topicId: active ? (topicId ?? undefined) : undefined,
  };
};
