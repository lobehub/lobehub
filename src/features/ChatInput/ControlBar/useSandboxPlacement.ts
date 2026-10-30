import { useCallback, useSyncExternalStore } from 'react';

import { useChatStore } from '@/store/chat';
import {
  getPendingSandboxSelection,
  setPendingSandboxSelection,
  subscribePendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * Where a conversation's cloud sandbox works, and what it starts from. Nothing
 * chosen is a temporary sandbox; choosing a folder IS the choice to keep files:
 *
 * - `workingDirectory` — a folder on the drive, relative to its root (`.` is
 *   the root itself);
 * - `environmentId` — a code environment to initialize the working directory
 *   from: its repository cloned and its setup run once there, whether that is
 *   a temporary sandbox or a folder on the drive. Independent of the folder;
 *   either can be set without the other.
 * - `instanceId` — an environment directory from before environments became
 *   one-time initializers. Read so an old conversation still shows where it
 *   runs; never written, and any new pick clears it.
 *
 * In a workspace, `drive` says which drive the folder is on — the public one
 * every member shares, or the member's personal one — and absent means public.
 */
export interface SandboxSelection {
  drive?: 'personal' | 'public';
  environmentId?: string;
  instanceId?: string;
  workingDirectory?: string;
}

/** Whether a selection keeps anything — a folder, or a legacy environment directory. */
export const isPersistentSelection = (selection: SandboxSelection) =>
  !!selection.instanceId || selection.workingDirectory !== undefined;

/**
 * What the current conversation's cloud sandbox keeps, read and written from
 * one place — the composer's chip and the working panel's file tree must see
 * the same state, or a pick in one would not move the other.
 *
 * Before a topic exists the choice is buffered by agent and carried by the
 * first send; see `pendingSandboxSelection`.
 *
 * `scopeTopicId` is the conversation the caller belongs to; `null` means it has
 * no topic yet. Omitted, it follows the global active topic.
 */
export const useSandboxPlacement = (agentId: string, scopeTopicId?: string | null) => {
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const topicId = scopeTopicId === undefined ? activeTopicId : scopeTopicId;
  const topicMetadata = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata : undefined,
  );
  const topicInstanceId = topicMetadata?.sandboxInstanceId;
  const topicWorkingDirectory = topicMetadata?.sandboxWorkingDirectory;
  const topicDrive = topicMetadata?.sandboxDrive;
  const topicEnvironmentId = topicMetadata?.sandboxEnvironmentId;
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);
  // The pending value lives outside React, so this subscribes to it the way a
  // store would be subscribed to. Every component using this hook re-renders
  // on a write, not just the one that wrote.
  const pending = useSyncExternalStore(subscribePendingSandboxSelection, () =>
    getPendingSandboxSelection(agentId),
  );

  const selection: SandboxSelection = topicId
    ? {
        drive: topicDrive,
        environmentId: topicEnvironmentId,
        instanceId: topicInstanceId,
        workingDirectory: topicWorkingDirectory,
      }
    : (pending ?? {});

  const setSelection = useCallback(
    async (next: SandboxSelection) => {
      if (!topicId) {
        setPendingSandboxSelection(agentId, next);
        return;
      }

      // Written whole, every field every time: a stale half left behind would
      // come back the moment the other was cleared. A legacy environment
      // directory is only ever carried forward as it was, never chosen anew.
      await updateTopicMetadata(topicId, {
        sandboxDrive: isPersistentSelection(next) ? next.drive : undefined,
        sandboxEnvironmentId: next.environmentId,
        sandboxInstanceId: next.instanceId,
        sandboxWorkingDirectory: next.instanceId ? undefined : next.workingDirectory,
      });
    },
    [agentId, topicId, updateTopicMetadata],
  );

  return { selection, setSelection, topicId: topicId ?? undefined };
};
