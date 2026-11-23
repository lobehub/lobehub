'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SafeBoundary from '@/components/ErrorBoundary';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useTopicId } from '../hooks/useTopicId';
import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import {
  getRememberedSandboxDirectory,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';
import SandboxDriveChip from './SandboxDriveChip';
import SandboxEnvironmentChip from './SandboxEnvironmentChip';
import {
  isOnPublicDrive,
  projectStartEnvironmentId,
  selectionWithDrive,
} from './sandboxEnvironmentOptions';
import type { SandboxRepositoryOption } from './SandboxRepositoryMenu';
import {
  setPrefersTemporarySandbox,
  usePrefersTemporarySandbox,
} from './temporarySandboxPreference';
import { useFollowSandboxModePreference } from './useFollowSandboxModePreference';
import {
  useIsSharedAgent,
  useProjectSandboxEnvironments,
  useSandboxEnvironmentList,
} from './useSandboxEnvironmentList';
import {
  isPersistentSelection,
  type SandboxSelection,
  useSandboxPlacement,
} from './useSandboxPlacement';
import { useSandboxStorageAccess } from './useSandboxStorageAccess';
import { useSeedDefaultSelection, useSeedTemporaryRepository } from './useSeedDefaultSelection';

interface SandboxStorageSectionProps {
  agentId: string;
}

/**
 * The options of a cloud-sandbox run — the counterpart of
 * `WorkingDirectorySection`, which covers runs on a machine. Two chips, each
 * one question:
 *
 * - **Drive** — whether the run keeps its files on the drive, and in which
 *   folder. Off is a temporary sandbox, cleaned up with the session.
 * - **Environment** — what the run is set up from before its first command,
 *   or nothing. Independent of the drive: either can be set without the other.
 *
 * A plan with a drive starts each new conversation on it — in the folder the
 * agent's last conversation was put in, or its default folder — unless the
 * drive was switched off for this agent, which new conversations then keep.
 * Either way a new conversation starts from the environment the agent's last
 * one used. A project conversation starts off the drive, in its project's
 * environment, unless the person switches the drive on.
 *
 * A plan without a drive still gets both chips: the temporary sandbox is
 * everyone's, and the drive chip shows the way to a plan.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { eligible, status } = useSandboxStorageAccess(agentId);
  const scopeTopicId = useTopicId();
  const { projectId, selection, setSelection, topicId } = useSandboxPlacement(
    agentId,
    scopeTopicId,
  );
  const workspaceId = useActiveWorkspaceId();
  const sharedAgent = useIsSharedAgent(agentId);
  // Only a run in the sandbox needs the project's environment.
  const { environments: projectEnvironments } = useProjectSandboxEnvironments(
    projectId,
    sharedAgent,
    eligible,
  );
  // The environment objects, for the folder an environment is set up in.
  const { environments, loaded: environmentsLoaded } = useSandboxEnvironmentList({
    enabled: status !== 'hidden',
    projectId,
    sharedAgent,
    workspaceId,
  });
  const userId = useUserStore(userProfileSelectors.userId);
  const scope = { userId, workspaceId };
  const prefersTemporary = usePrefersTemporarySandbox(scope, agentId);
  // A project conversation starts off the drive, in its project's environment;
  // the agent's drive preference is about its conversations elsewhere.
  const temporary = prefersTemporary || !!projectId;
  useFollowSandboxModePreference(agentId, {
    enabled: !projectId,
    hasTopic: !!topicId,
    scopeKey: `${userId ?? ''}:${workspaceId ?? ''}:${agentId}`,
    temporary: prefersTemporary,
  });
  // Every pick that lands is remembered for the next conversation: the folder,
  // and the environment (or none). A failed save is not, and neither is an
  // environment picked inside a project: it belongs to that project, and the
  // agent's next conversation elsewhere could not use it. A drive folder is
  // usable anywhere.
  //
  // Every member can browse the workspace's public drive, so a private
  // environment — or one not known to be published — is not carried into a
  // folder there: the server would not apply it, and the chip would name a
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
  // Switching the drive on starts in the environment's own folder when one is
  // picked, so it is set up in an empty folder; otherwise in the folder the
  // agent's last conversation used. Off keeps the environment. Outside a
  // project the switch is also where the agent's new conversations start.
  const toggleDrive = useCallback(
    async (enabled: boolean) => {
      const defaultFolder = resolveDefaultSandboxSelection(
        workspaceId,
        getRememberedSandboxDirectory({ userId, workspaceId }, agentId),
      );
      const environment = environments.find((item) => item.id === selection.environmentId);
      await pick(selectionWithDrive(selection, enabled, { defaultFolder, environment }));
      if (!projectId) setPrefersTemporarySandbox({ userId, workspaceId }, agentId, !enabled);
    },
    [agentId, environments, pick, projectId, selection, userId, workspaceId],
  );
  useSeedDefaultSelection(agentId, {
    eligible: eligible && !temporary,
    entitled: status === 'ready' && !temporary,
    hasTopic: !!topicId,
  });
  // Where new conversations start off the drive — switched off, a project's,
  // or the only one a plan without a drive has — they start from the
  // environment the last one used.
  useSeedTemporaryRepository(agentId, {
    eligible,
    hasTopic: !!topicId,
    project: projectId
      ? { environmentId: projectStartEnvironmentId(projectEnvironments) }
      : undefined,
    temporary: eligible && (temporary || status === 'upgrade'),
  });

  if (status === 'hidden') return null;

  const entitled = status === 'ready';
  // The drive is switched on into the environment's own folder, which is
  // named after it: until the list says what the environment is, the switch
  // waits rather than putting it in a folder that may already hold files.
  const environmentPending =
    !!selection.environmentId &&
    !environmentsLoaded &&
    !environments.some((item) => item.id === selection.environmentId);

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <SandboxDriveChip
        entitled={entitled}
        toggleDisabled={environmentPending}
        topicId={topicId}
        value={selection}
        onChange={pick}
        onToggle={toggleDrive}
      />
      <SandboxEnvironmentChip
        projectId={projectId}
        // A folder on the public drive is set up from published environments only.
        sharedAgent={sharedAgent || isOnPublicDrive(selection, workspaceId)}
        value={selection}
        onChange={pick}
        onDrive={entitled && isPersistentSelection(selection)}
      />
    </Flexbox>
  );
});

SandboxStorageSectionInner.displayName = 'SandboxStorageSectionInner';

const SandboxStorageSection = memo<SandboxStorageSectionProps>(({ agentId }) => (
  <SafeBoundary minHeight={22} resetKeys={[agentId]}>
    <SandboxStorageSectionInner agentId={agentId} />
  </SafeBoundary>
));

SandboxStorageSection.displayName = 'SandboxStorageSection';

export default SandboxStorageSection;
