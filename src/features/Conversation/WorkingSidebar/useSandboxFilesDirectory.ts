import useSWR from 'swr';

import {
  isPersistentSelection,
  useSandboxPlacement,
} from '@/features/ChatInput/ControlBar/useSandboxPlacement';
import { sandboxStorageService } from '@/services/sandboxStorage';
import { sandboxActions, sandboxSelectors, useSandboxStore } from '@/store/sandbox';

/**
 * Which tree a cloud-sandbox conversation's Files tab shows.
 *
 * A run that keeps files shows its folder on the drive. A temporary sandbox
 * shows the sandbox itself (`ephemeral`), read live through the conversation's
 * own session — so only once a topic exists, since a draft has no session and
 * pointing the panel at the drive would let another conversation's files read
 * as this one's. Read through the same hook the composer writes with, so the
 * panel sees a choice the moment it is made — including one buffered on the
 * agent before the conversation exists.
 *
 * `directory` is relative to the drive's root, where `''` IS the root (a
 * folder picked as `.`); for a temporary sandbox it is `''`, the directory the
 * sandbox starts in. An environment directory has to be looked up first, and
 * until it is `directoryKnown` is false — the empty string would otherwise
 * read as "the whole drive" and the tree would list every folder on it for as
 * long as the lookup took.
 */
export const useSandboxFilesDirectory = (
  agentId: string,
  { isSandboxTarget, topicId }: { isSandboxTarget: boolean; topicId?: string | null },
) => {
  const { selection } = useSandboxPlacement(agentId);
  const instanceId = selection.instanceId;
  const picked = isSandboxTarget && isPersistentSelection(selection);
  // A pick the run cannot honour — the folder was deleted, the plan lapsed —
  // sends the run to a temporary sandbox, so ask the resolver the run uses.
  // Shares the composer's key: one request answers both. `null` means no
  // drive at all, which is a temporary sandbox too; until it answers, the
  // pick stands.
  const { data: placement } = useSWR(
    picked && topicId
      ? [
          'sandbox-drive-placement',
          topicId,
          selection.drive ?? '',
          selection.instanceId ?? '',
          selection.workingDirectory ?? '',
        ]
      : null,
    () => sandboxStorageService.resolveSessionPlacement({ topicId: topicId ?? undefined }),
    { revalidateOnFocus: true },
  );
  const fellBack = placement === null || placement?.mode === 'ephemeral';
  const persistent = picked && !fellBack;
  const ephemeral = isSandboxTarget && !persistent && !!topicId;
  const active = persistent || ephemeral;

  // A replica, so a reload paints the directory (and the Files tab) from the
  // last answer; `null` is an instance known to be gone.
  sandboxActions.useFetchInstanceDirectory(persistent ? instanceId : undefined);
  const instanceDirectory = useSandboxStore(
    sandboxSelectors.instanceDirectory(persistent ? instanceId : undefined),
  );

  const directory = !persistent
    ? ''
    : instanceId
      ? (instanceDirectory ?? '')
      : selection.workingDirectory && selection.workingDirectory !== '.'
        ? selection.workingDirectory
        : '';

  return {
    active,
    directory,
    directoryKnown: !persistent || !instanceId || instanceDirectory !== undefined,
    ephemeral,
    instanceId: persistent ? instanceId : undefined,
    topicId: active ? (topicId ?? undefined) : undefined,
  };
};
