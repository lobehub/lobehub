import { useEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  getPendingSandboxSelection,
  setPendingSandboxSelection,
  setSandboxDefaultSelection,
} from '@/store/chat/pendingSandboxSelection';

import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';

/**
 * Give a conversation that does not exist yet the plan's default place to
 * work: an account with a drive keeps its files unless it says otherwise. Only
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

  // Cleared on unmount as well: once the run moves off the sandbox, nothing
  // should hand a sandbox folder to a conversation on a machine.
  useEffect(() => {
    if (!eligible) return;

    setSandboxDefaultSelection(agentId, resolveDefaultSandboxSelection(workspaceId));
    return () => setSandboxDefaultSelection(agentId);
  }, [agentId, eligible, workspaceId]);

  useEffect(() => {
    if (!entitled || hasTopic || getPendingSandboxSelection(agentId)) return;

    setPendingSandboxSelection(agentId, resolveDefaultSandboxSelection(workspaceId));
  }, [agentId, entitled, hasTopic, workspaceId]);
};
