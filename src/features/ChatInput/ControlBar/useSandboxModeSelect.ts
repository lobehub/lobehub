import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { seedPendingSandboxSelection } from '@/store/chat/pendingSandboxSelection';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import {
  getRememberedSandboxDirectory,
  getRememberedSandboxRepository,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';
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
  const userId = useUserStore(userProfileSelectors.userId);
  const driveStatus = useSandboxDriveStatus(enabled);
  const { selection, setSelection, topicId: scopeTopicId } = useSandboxPlacement(agentId, topicId);
  const onDrive = isPersistentSelection(selection);

  const toTemporary = useCallback(async () => {
    // Without a drive there is only one sandbox, and nothing to remember.
    if (driveStatus === 'hidden') return;

    // Remembered only once the conversation has moved: a failed write leaves
    // it where it was, and new conversations must not start elsewhere.
    // Leaving the drive, the conversation starts from the repository the
    // agent's last temporary sandbox used, or none.
    if (onDrive) {
      const next =
        getRememberedSandboxRepository({ userId, workspaceId }, agentId) ??
        temporarySelection(selection);
      await setSelection(next);
      // What the conversation now runs on is what the next temporary sandbox
      // starts from, as a pick in the chip would be.
      rememberSandboxSelection({ userId, workspaceId }, agentId, next);
    }
    setPrefersTemporarySandbox({ userId, workspaceId }, agentId, true);
  }, [agentId, driveStatus, onDrive, selection, setSelection, userId, workspaceId]);

  const toPersistent = useCallback(async () => {
    if (!onDrive) {
      // Back on the drive in the folder the agent's last conversation used,
      // the same default a new conversation gets.
      const next = resolveDefaultSandboxSelection(
        workspaceId,
        getRememberedSandboxDirectory({ userId, workspaceId }, agentId),
      );
      // A conversation not started yet gets the default as a default, not as a
      // pick: a project conversation is then still given its repository checkout.
      if (scopeTopicId) {
        await setSelection(next);
        rememberSandboxSelection({ userId, workspaceId }, agentId, next);
      } else seedPendingSandboxSelection(agentId, next);
    }
    // After the move, as above: a failed write keeps the old preference too.
    setPrefersTemporarySandbox({ userId, workspaceId }, agentId, false);
  }, [agentId, onDrive, scopeTopicId, setSelection, userId, workspaceId]);

  return {
    driveStatus,
    // While the entitlement loads, the placement the conversation already has
    // is still what it runs on — said as such rather than as temporary.
    persistent: (driveStatus === 'ready' || driveStatus === 'loading') && onDrive,
    toPersistent,
    toTemporary,
  };
};
