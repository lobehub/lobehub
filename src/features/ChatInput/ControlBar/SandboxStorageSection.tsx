'use client';

import { memo, useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SafeBoundary from '@/components/ErrorBoundary';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useTopicId } from '../hooks/useTopicId';
import { rememberSandboxSelection } from './rememberedSandboxDirectory';
import SandboxDrivePicker from './SandboxDrivePicker';
import { projectStartEnvironmentId } from './sandboxEnvironmentOptions';
import { usePrefersTemporarySandbox } from './temporarySandboxPreference';
import { useFollowSandboxModePreference } from './useFollowSandboxModePreference';
import { useIsSharedAgent, useProjectSandboxEnvironments } from './useSandboxEnvironmentList';
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
 * The working directory of a cloud-sandbox run — the counterpart of
 * `WorkingDirectorySection`, which covers runs on a machine, and shaped the
 * same way: one chip that always names the slot, whose menu holds every place
 * the run could work.
 *
 * Nothing chosen means a temporary sandbox, cleaned up with the session; a
 * folder on the drive keeps its files, and a repository starts from a checkout.
 * A plan with a drive starts each new conversation in the folder the agent's
 * last conversation was put in, or on its default folder rather than nothing —
 * unless the execution-environment menu moved the agent to the
 * temporary cloud sandbox, which new conversations then keep, initialized from
 * the repository the last temporary sandbox used (or none).
 *
 * A plan without a drive still gets the chip: the temporary sandbox is
 * everyone's, and the way to a plan is a row in the same menu rather than a
 * different control.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { eligible, status } = useSandboxStorageAccess(agentId);
  const scopeTopicId = useTopicId();
  // A project conversation runs in its project's environment.
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
  // The temporary and persistent sandboxes are picked in the execution
  // environment menu — when this member can use it. A target the author fixed
  // leaves that menu read-only, so the choice stays in this one.
  const { canUseResource } = useChatInputResourceAccess();
  const { canDisplayExecutionTarget, canSelectExecutionTarget } = useEffectiveAgencyConfig(
    agentId,
    { topicId: scopeTopicId },
  );
  const modeInEnvironmentMenu =
    canUseResource && canDisplayExecutionTarget && canSelectExecutionTarget;
  const userId = useUserStore(userProfileSelectors.userId);
  const prefersTemporary = usePrefersTemporarySandbox({ userId, workspaceId }, agentId);
  // Only a pick made in that menu counts; a member who cannot make it is not
  // held to one made before the target was fixed.
  const temporary = prefersTemporary && modeInEnvironmentMenu;
  useFollowSandboxModePreference(agentId, {
    enabled: modeInEnvironmentMenu,
    hasTopic: !!topicId,
    scopeKey: `${userId ?? ''}:${workspaceId ?? ''}:${agentId}`,
    temporary: prefersTemporary,
  });
  // Every pick that lands is remembered for the next conversation: the folder
  // for the persistent sandbox, the repository (or none) for the temporary
  // one. A failed save is not, and neither is an environment picked inside a
  // project: it belongs to that project, and the agent's next conversation
  // elsewhere could not use it. A drive folder is usable anywhere.
  const pick = useCallback(
    async (next: SandboxSelection) => {
      await setSelection(next);
      if (!projectId || isPersistentSelection(next))
        rememberSandboxSelection({ userId, workspaceId }, agentId, next);
    },
    [agentId, projectId, setSelection, userId, workspaceId],
  );
  useSeedDefaultSelection(agentId, {
    eligible: eligible && !temporary,
    entitled: status === 'ready' && !temporary,
    hasTopic: !!topicId,
  });
  // Where new conversations start in the temporary sandbox — picked in the
  // environment menu, or the only one a plan without a drive has — they start
  // from the repository the last one used.
  useSeedTemporaryRepository(agentId, {
    eligible,
    hasTopic: !!topicId,
    project: projectId
      ? { environmentId: projectStartEnvironmentId(projectEnvironments) }
      : undefined,
    temporary: eligible && (temporary || status === 'upgrade'),
  });

  if (status === 'hidden') return null;

  return (
    <SandboxDrivePicker
      entitled={status === 'ready'}
      modeInEnvironmentMenu={modeInEnvironmentMenu}
      projectId={projectId}
      sharedAgent={sharedAgent}
      topicId={topicId}
      value={selection}
      onChange={pick}
    />
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
