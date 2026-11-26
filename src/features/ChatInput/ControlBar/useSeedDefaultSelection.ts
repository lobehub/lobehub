import { useEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  getPendingSandboxSelection,
  isSeededSandboxSelection,
  seedPendingSandboxSelection,
  setPendingSandboxSelection,
  setSandboxDefaultSelection,
  setSandboxTemporaryDefaultSelection,
} from '@/store/chat/pendingSandboxSelection';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import { getRememberedSandboxDirectory } from './rememberedSandboxDirectory';

/**
 * The drive default: the folder the agent's last conversation was put in, or
 * the plan's default folder. The cloud sandbox is not set up from an
 * environment, so an environment remembered with that folder from before is
 * not brought back.
 */
const driveDefault = (
  scope: { userId?: string | null; workspaceId?: string | null },
  agentId: string,
) =>
  resolveDefaultSandboxSelection(scope.workspaceId, getRememberedSandboxDirectory(scope, agentId));

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

    setSandboxDefaultSelection(agentId, driveDefault({ userId, workspaceId }, agentId));
    return () => setSandboxDefaultSelection(agentId);
  }, [agentId, eligible, hasTopic, userId, workspaceId]);

  useEffect(() => {
    if (!entitled || hasTopic) return;
    // A pick stays; a default filled in earlier is provisional and is filled in
    // again — the user id can arrive after the entitlement on a cold boot, and
    // the remembered folder only becomes readable then.
    const pending = getPendingSandboxSelection(agentId);
    if (pending && !isSeededSandboxSelection(pending)) return;

    seedPendingSandboxSelection(agentId, driveDefault({ userId, workspaceId }, agentId));
  }, [agentId, entitled, hasTopic, userId, workspaceId]);
};

/**
 * The temporary sandbox's counterpart, for a project conversation that does not
 * exist yet: it starts from its project's environment — the one the server
 * applies to a default nobody picked. `project.environmentId` is that
 * environment, or undefined while it loads or when the server would apply none.
 *
 * Any other conversation starts from no environment, the temporary sandbox's
 * own default: the cloud sandbox is not set up from one, so the repository an
 * agent's earlier conversation used is not brought back, and one left as a
 * default by an earlier render is cleared.
 *
 * Filled in as a default rather than a pick, the same as the folder: a pick
 * stays.
 */
export const useSeedTemporaryRepository = (
  agentId: string,
  {
    eligible,
    hasTopic,
    project,
    temporary,
  }: {
    eligible: boolean;
    hasTopic: boolean;
    /** Set when the conversation belongs to a project. */
    project?: { environmentId?: string };
    temporary: boolean;
  },
) => {
  // Outside a project there is none.
  const environmentId = project?.environmentId;

  // Registered as soon as the run is known to use the sandbox — before the
  // entitlement — so a first send that turns out to have no drive still
  // starts from the project's repository. Cleared on unmount, like the drive
  // default. Only a conversation not created yet registers one: the entry is
  // the agent's, and a split pane already on a topic — a project's, say —
  // would hand its environment to another pane's first send, or clear it.
  useEffect(() => {
    if (!eligible || hasTopic) return;
    setSandboxTemporaryDefaultSelection(agentId, environmentId ? { environmentId } : undefined);
    return () => setSandboxTemporaryDefaultSelection(agentId);
  }, [agentId, eligible, environmentId, hasTopic]);

  useEffect(() => {
    if (!temporary || hasTopic) return;
    const pending = getPendingSandboxSelection(agentId);
    if (pending && !isSeededSandboxSelection(pending)) return;

    if (environmentId) seedPendingSandboxSelection(agentId, { environmentId });
    // A default environment nothing replaces is stale: a project's environment
    // once the agent's next conversation is not that project's.
    else if (pending?.environmentId) setPendingSandboxSelection(agentId);
  }, [agentId, environmentId, hasTopic, temporary]);
};
