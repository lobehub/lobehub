'use client';

import { memo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SafeBoundary from '@/components/ErrorBoundary';
import { useChatInputResourceAccess } from '@/features/ChatInput/hooks/useChatInputResourceAccess';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useTopicId } from '../hooks/useTopicId';
import SandboxDrivePicker from './SandboxDrivePicker';
import { usePrefersTemporarySandbox } from './temporarySandboxPreference';
import { useFollowSandboxModePreference } from './useFollowSandboxModePreference';
import { useSandboxPlacement } from './useSandboxPlacement';
import { useSandboxStorageAccess } from './useSandboxStorageAccess';
import { useSeedDefaultSelection } from './useSeedDefaultSelection';

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
 * A plan with a drive starts each new conversation on its default folder rather
 * than nothing — unless the execution-environment menu moved the agent to the
 * temporary cloud sandbox, which new conversations then keep.
 *
 * A plan without a drive still gets the chip: the temporary sandbox is
 * everyone's, and the way to a plan is a row in the same menu rather than a
 * different control.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { eligible, status } = useSandboxStorageAccess(agentId);
  const scopeTopicId = useTopicId();
  const { selection, setSelection, topicId } = useSandboxPlacement(agentId, scopeTopicId);
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
  const workspaceId = useActiveWorkspaceId();
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
  useSeedDefaultSelection(agentId, {
    eligible: eligible && !temporary,
    entitled: status === 'ready' && !temporary,
    hasTopic: !!topicId,
  });

  if (status === 'hidden') return null;

  return (
    <SandboxDrivePicker
      entitled={status === 'ready'}
      modeInEnvironmentMenu={modeInEnvironmentMenu}
      topicId={topicId}
      value={selection}
      onChange={setSelection}
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
