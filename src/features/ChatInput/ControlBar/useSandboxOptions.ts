import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { sandboxActions, sandboxSelectors, useSandboxStore } from '@/store/sandbox';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { rememberSandboxSelection } from './rememberedSandboxDirectory';
import type { SandboxDriveFolderPick } from './SandboxDriveMenu';
import { isOnPublicDrive, selectionWithFolder } from './sandboxEnvironmentOptions';
import { setPrefersTemporarySandbox } from './temporarySandboxPreference';
import { useIsSharedAgent, useProjectSandboxEnvironments } from './useSandboxEnvironmentList';
import {
  isPersistentSelection,
  type SandboxSelection,
  useSandboxPlacement,
} from './useSandboxPlacement';

/**
 * Whether the plan includes a drive, asked whenever the cloud sandbox's options
 * could be shown — before the sandbox is picked, not only once it runs there.
 *
 * - `hidden` — no drive service in this deployment (self-hosted);
 * - `loading` — not known yet: a pick still moves the conversation as asked;
 * - `upgrade` — no drive on this plan; the drive option leads to one;
 * - `ready` — entitled.
 */
export type SandboxDriveStatus = 'hidden' | 'loading' | 'ready' | 'upgrade';

const useSandboxDriveStatus = (enabled: boolean): SandboxDriveStatus => {
  const shouldAsk = ENABLE_BUSINESS_FEATURES && enabled;
  sandboxActions.useFetchEntitlement(shouldAsk, { revalidateOnFocus: false });
  const data = useSandboxStore(sandboxSelectors.entitlement);

  if (!shouldAsk) return 'hidden';
  if (!data) return 'loading';
  return data.entitled ? 'ready' : 'upgrade';
};

/**
 * The cloud sandbox's one option — whether it keeps its files on the drive,
 * and in which folder — read and written from one place. The
 * execution-environment menu offers it under its 云端沙箱 row; new
 * conversations are seeded by `SandboxStorageSection`, which this hook leaves
 * alone.
 *
 * The sandbox is not set up from an environment any more: only a project
 * conversation still carries one — its project's, applied by the server — and
 * a pick keeps it there. Anywhere else an environment left on the topic from
 * before is dropped with the next pick.
 *
 * `topicId` is the conversation the caller belongs to; `null` means it has no
 * topic yet.
 */
export const useSandboxOptions = (
  agentId: string,
  { enabled, topicId: scopeTopicId }: { enabled: boolean; topicId: string | null },
) => {
  const driveStatus = useSandboxDriveStatus(enabled);
  const { projectId, selection, setSelection, topicId } = useSandboxPlacement(
    agentId,
    scopeTopicId,
  );
  const workspaceId = useActiveWorkspaceId();
  const userId = useUserStore(userProfileSelectors.userId);
  const sharedAgent = useIsSharedAgent(agentId);
  // Only a project's own environment can still apply, so only its visibility
  // is asked: a private one is not carried into a public-drive folder.
  const { environments } = useProjectSandboxEnvironments(projectId, sharedAgent, enabled);

  // Every pick that lands is remembered for the next conversation — the
  // folder, which is usable anywhere, inside a project or not. A failed save
  // is not.
  //
  // Every member can browse the workspace's public drive, so a private
  // environment — or one not known to be published — is not carried into a
  // folder there: the server would not apply it.
  const pick = useCallback(
    async (picked: SandboxSelection): Promise<SandboxSelection> => {
      const environment = environments.find((item) => item.id === picked.environmentId);
      const next =
        picked.environmentId &&
        (!projectId ||
          (environment?.visibility !== 'public' && isOnPublicDrive(picked, workspaceId)))
          ? { ...picked, environmentId: undefined }
          : picked;
      await setSelection(next);
      rememberSandboxSelection({ userId, workspaceId }, agentId, next);
      return next;
    },
    [agentId, environments, projectId, setSelection, userId, workspaceId],
  );

  // Storage is picked under the cloud sandbox's row: a temporary sandbox, or a
  // folder of the drive. Either keeps a project's environment. Outside a
  // project the pick is also where the agent's new conversations start.
  const toTemporary = useCallback(async () => {
    await pick(selection.environmentId ? { environmentId: selection.environmentId } : {});
    if (!projectId) setPrefersTemporarySandbox({ userId, workspaceId }, agentId, true);
  }, [agentId, pick, projectId, selection.environmentId, userId, workspaceId]);

  const pickFolder = useCallback(
    async (folder: SandboxDriveFolderPick) => {
      const next = await pick(selectionWithFolder(selection, folder));
      if (!projectId) setPrefersTemporarySandbox({ userId, workspaceId }, agentId, false);
      return next;
    },
    [agentId, pick, projectId, selection, userId, workspaceId],
  );

  const entitled = driveStatus === 'ready';
  // While the entitlement loads, the placement the conversation already has
  // is still what it runs on — said as such rather than as temporary.
  const onDrive =
    (driveStatus === 'ready' || driveStatus === 'loading') && isPersistentSelection(selection);

  return {
    driveStatus,
    entitled,
    onDrive,
    pick,
    pickFolder,
    projectId,
    selection,
    toTemporary,
    topicId,
    workspaceId,
  };
};
