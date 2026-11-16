import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { seedPendingSandboxSelection } from '@/store/chat/pendingSandboxSelection';

import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import { setPrefersTemporarySandbox } from './temporarySandboxPreference';
import {
  isPersistentSelection,
  type SandboxSelection,
  useSandboxPlacement,
} from './useSandboxPlacement';
import { useSandboxDriveStatus } from './useSandboxStorageAccess';

/**
 * Where a conversation leaving the drive works: the temporary sandbox, still
 * initialized from the repository it was on. A repository checkout only lands
 * in an empty folder, which a fresh temporary sandbox always is.
 */
export const temporarySelection = (selection: SandboxSelection): SandboxSelection =>
  selection.environmentId ? { environmentId: selection.environmentId } : {};

/**
 * The two cloud-sandbox rows of the execution-environment menu. Both run on the
 * `sandbox` target; what tells them apart is whether the conversation keeps its
 * files on the drive, so the rows read and write the same selection the
 * working-directory chip does:
 *
 * - **Cloud sandbox** — temporary. The conversation leaves its drive folder,
 *   and the agent's new conversations stop starting on one.
 * - **Persistent sandbox** — the drive. A conversation not on it yet starts at
 *   the plan's default folder, and the working-directory chip then lists the
 *   drive's folders directly.
 *
 * Only offered with a plan that includes a drive (`driveStatus: 'ready'`); an
 * account without one is shown the way to a plan instead.
 */
export const useSandboxModeSelect = (
  agentId: string,
  { enabled, topicId }: { enabled: boolean; topicId: string | null },
) => {
  const workspaceId = useActiveWorkspaceId();
  const driveStatus = useSandboxDriveStatus(enabled);
  const { selection, setSelection, topicId: scopeTopicId } = useSandboxPlacement(agentId, topicId);
  const onDrive = isPersistentSelection(selection);

  const toTemporary = useCallback(async () => {
    // Without a drive there is only one sandbox, and nothing to remember.
    if (driveStatus === 'hidden') return;

    // Remembered only once the conversation has moved: a failed write leaves
    // it where it was, and new conversations must not start elsewhere.
    if (onDrive) await setSelection(temporarySelection(selection));
    setPrefersTemporarySandbox(workspaceId, agentId, true);
  }, [agentId, driveStatus, onDrive, selection, setSelection, workspaceId]);

  const toPersistent = useCallback(async () => {
    if (!onDrive) {
      const next = resolveDefaultSandboxSelection(workspaceId);
      // A conversation not started yet gets the default as a default, not as a
      // pick: a project conversation is then still given its repository checkout.
      if (scopeTopicId) await setSelection(next);
      else seedPendingSandboxSelection(agentId, next);
    }
    // After the move, as above: a failed write keeps the old preference too.
    setPrefersTemporarySandbox(workspaceId, agentId, false);
  }, [agentId, onDrive, scopeTopicId, setSelection, workspaceId]);

  return {
    driveStatus,
    persistent: driveStatus === 'ready' && onDrive,
    toPersistent,
    toTemporary,
  };
};
