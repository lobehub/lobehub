import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { sandboxActions, sandboxSelectors, useSandboxStore } from '@/store/sandbox';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { rememberSandboxSelection } from './rememberedSandboxDirectory';
import type { SandboxDriveFolderPick } from './SandboxDriveMenu';
import { isOnPublicDrive, selectionWithFolder } from './sandboxEnvironmentOptions';
import type { SandboxRepositoryOption } from './SandboxRepositoryMenu';
import { setPrefersTemporarySandbox } from './temporarySandboxPreference';
import { useIsSharedAgent, useSandboxEnvironmentList } from './useSandboxEnvironmentList';
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
 * The cloud sandbox's two options — whether it keeps its files on the drive
 * (and in which folder), and the environment it is set up from — read and
 * written from one place. The execution-environment menu offers them under
 * its 云端沙箱 row and its chip names them; new conversations are seeded by
 * `SandboxStorageSection`, which this hook leaves alone.
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
  const environmentList = useSandboxEnvironmentList({
    enabled,
    projectId,
    sharedAgent,
    workspaceId,
  });
  const { environments } = environmentList;

  // Every pick that lands is remembered for the next conversation: the folder,
  // and the environment (or none). A failed save is not, and neither is an
  // environment picked inside a project: it belongs to that project, and the
  // agent's next conversation elsewhere could not use it. A drive folder is
  // usable anywhere.
  //
  // Every member can browse the workspace's public drive, so a private
  // environment — or one not known to be published — is not carried into a
  // folder there: the server would not apply it, and the menu would name a
  // setup that never runs.
  const pick = useCallback(
    async (
      picked: SandboxSelection,
      { environment: given }: { environment?: SandboxRepositoryOption } = {},
    ) => {
      // An environment whose visibility is not known — the list still loading
      // or failed — is treated as private: it is only known to be published
      // once the list, or the pick itself (one just created, which this
      // render's list cannot hold yet), says so.
      const environment =
        given?.id === picked.environmentId
          ? given
          : environments.find((item) => item.id === picked.environmentId);
      const next =
        picked.environmentId &&
        environment?.visibility !== 'public' &&
        isOnPublicDrive(picked, workspaceId)
          ? { ...picked, environmentId: undefined }
          : picked;
      await setSelection(next);
      rememberSandboxSelection({ userId, workspaceId }, agentId, next, {
        folderOnly: !!projectId,
      });
    },
    [agentId, environments, projectId, setSelection, userId, workspaceId],
  );

  // Storage is picked one level under its row: a temporary sandbox, or a
  // folder of the drive. Either keeps the environment. Outside a project the
  // pick is also where the agent's new conversations start.
  const toTemporary = useCallback(async () => {
    await pick(selection.environmentId ? { environmentId: selection.environmentId } : {});
    if (!projectId) setPrefersTemporarySandbox({ userId, workspaceId }, agentId, true);
  }, [agentId, pick, projectId, selection.environmentId, userId, workspaceId]);

  const pickFolder = useCallback(
    async (folder: SandboxDriveFolderPick) => {
      const next = selectionWithFolder(selection, folder);
      await pick(next);
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
    environmentList,
    onDrive,
    onPublicDrive: onDrive && isOnPublicDrive(selection, workspaceId),
    pick,
    pickFolder,
    projectId,
    selection,
    sharedAgent,
    toTemporary,
    topicId,
    workspaceId,
  };
};
