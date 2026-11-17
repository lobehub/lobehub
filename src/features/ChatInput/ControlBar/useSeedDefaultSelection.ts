import { useEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  getPendingSandboxSelection,
  isSeededSandboxSelection,
  seedPendingSandboxSelection,
  setSandboxDefaultSelection,
  setSandboxTemporaryDefaultSelection,
} from '@/store/chat/pendingSandboxSelection';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import {
  getRememberedSandboxDirectory,
  getRememberedSandboxRepository,
} from './rememberedSandboxDirectory';

/**
 * Give a conversation that does not exist yet the plan's default place to
 * work: an account with a drive keeps its files unless it says otherwise, in the
 * folder the agent's last conversation was put in when there is one. Only
 * fills an empty slot — a pick, including the temporary sandbox, stays — and
 * only before the topic exists, so a conversation already running never moves.
 * Sending consumes the slot, and the next new conversation is seeded again.
 *
 * Two halves, because the entitlement loads after the composer does. The
 * default is registered as soon as the run is known to use the sandbox, and
 * the first send settles it against the entitlement — so a message sent before
 * the answer arrives still starts on the drive. Once the answer is in, the
 * slot is filled here too, which is what the chip names.
 */
export const useSeedDefaultSelection = (
  agentId: string,
  { eligible, entitled, hasTopic }: { eligible: boolean; entitled: boolean; hasTopic: boolean },
) => {
  const workspaceId = useActiveWorkspaceId();
  const userId = useUserStore(userProfileSelectors.userId);

  // Cleared on unmount as well: once the run moves off the sandbox, nothing
  // should hand a sandbox folder to a conversation on a machine. Registered
  // again whenever a new conversation opens, so it carries the folder picked
  // in the conversation before.
  useEffect(() => {
    if (!eligible) return;

    setSandboxDefaultSelection(
      agentId,
      resolveDefaultSandboxSelection(
        workspaceId,
        getRememberedSandboxDirectory({ userId, workspaceId }, agentId),
      ),
    );
    return () => setSandboxDefaultSelection(agentId);
  }, [agentId, eligible, hasTopic, userId, workspaceId]);

  useEffect(() => {
    if (!entitled || hasTopic) return;
    // A pick stays; a default filled in earlier is provisional and is filled in
    // again — the user id can arrive after the entitlement on a cold boot, and
    // the remembered folder only becomes readable then.
    const pending = getPendingSandboxSelection(agentId);
    if (pending && !isSeededSandboxSelection(pending)) return;

    seedPendingSandboxSelection(
      agentId,
      resolveDefaultSandboxSelection(
        workspaceId,
        getRememberedSandboxDirectory({ userId, workspaceId }, agentId),
      ),
    );
  }, [agentId, entitled, hasTopic, userId, workspaceId]);
};

/**
 * The temporary sandbox's counterpart: a conversation that does not exist yet,
 * for an agent whose new conversations start in the temporary sandbox, starts
 * from the repository the agent's last temporary sandbox used — or from none,
 * which is the temporary sandbox's own default and needs nothing filled in.
 *
 * Filled in as a default rather than a pick, the same as the folder: a pick
 * stays, and a project conversation is still given its project's checkout.
 */
export const useSeedTemporaryRepository = (
  agentId: string,
  { eligible, hasTopic, temporary }: { eligible: boolean; hasTopic: boolean; temporary: boolean },
) => {
  const workspaceId = useActiveWorkspaceId();
  const userId = useUserStore(userProfileSelectors.userId);

  // Registered as soon as the run is known to use the sandbox — before the
  // entitlement — so a first send that turns out to have no drive still
  // starts from the remembered repository. Cleared on unmount, like the drive
  // default.
  useEffect(() => {
    if (!eligible) return;
    const environmentId = getRememberedSandboxRepository(
      { userId, workspaceId },
      agentId,
    )?.environmentId;
    setSandboxTemporaryDefaultSelection(agentId, environmentId ? { environmentId } : undefined);
    return () => setSandboxTemporaryDefaultSelection(agentId);
  }, [agentId, eligible, hasTopic, userId, workspaceId]);

  useEffect(() => {
    if (!temporary || hasTopic) return;
    const pending = getPendingSandboxSelection(agentId);
    if (pending && !isSeededSandboxSelection(pending)) return;

    const environmentId = getRememberedSandboxRepository(
      { userId, workspaceId },
      agentId,
    )?.environmentId;
    if (environmentId) seedPendingSandboxSelection(agentId, { environmentId });
  }, [agentId, hasTopic, temporary, userId, workspaceId]);
};
