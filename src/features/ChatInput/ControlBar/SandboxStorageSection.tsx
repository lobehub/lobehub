'use client';

import { memo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SafeBoundary from '@/components/ErrorBoundary';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useTopicId } from '../hooks/useTopicId';
import { projectStartEnvironmentId } from './sandboxEnvironmentOptions';
import { usePrefersTemporarySandbox } from './temporarySandboxPreference';
import { useFollowSandboxModePreference } from './useFollowSandboxModePreference';
import { useIsSharedAgent, useProjectSandboxEnvironments } from './useSandboxEnvironmentList';
import { useSandboxPlacement } from './useSandboxPlacement';
import { useSandboxStorageAccess } from './useSandboxStorageAccess';
import { useSeedDefaultSelection, useSeedTemporaryRepository } from './useSeedDefaultSelection';

interface SandboxStorageSectionProps {
  agentId: string;
}

/**
 * Where a new conversation's cloud sandbox starts, kept in step while the run
 * uses the sandbox. It renders nothing: the sandbox's options — the drive and
 * the environment — are picked under the 云端沙箱 row of the
 * execution-environment menu, whose chip is the only control under the input.
 *
 * A plan with a drive starts each new conversation on it — in the folder the
 * agent's last conversation was put in, or its default folder, with the
 * environment picked together with that folder — unless the drive was
 * switched off for this agent, which new conversations then keep, set up from
 * the environment the last one used. A project conversation starts off the
 * drive, in its project's environment, unless the person switches the drive
 * on.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { eligible, status } = useSandboxStorageAccess(agentId);
  const scopeTopicId = useTopicId();
  const { projectId, topicId } = useSandboxPlacement(agentId, scopeTopicId);
  const workspaceId = useActiveWorkspaceId();
  const sharedAgent = useIsSharedAgent(agentId);
  // Only a run in the sandbox needs the project's environment.
  const { environments: projectEnvironments } = useProjectSandboxEnvironments(
    projectId,
    sharedAgent,
    eligible,
  );
  const userId = useUserStore(userProfileSelectors.userId);
  const prefersTemporary = usePrefersTemporarySandbox({ userId, workspaceId }, agentId);
  // A project conversation starts off the drive, in its project's environment;
  // the agent's drive preference is about its conversations elsewhere.
  const temporary = prefersTemporary || !!projectId;
  useFollowSandboxModePreference(agentId, {
    enabled: !projectId,
    hasTopic: !!topicId,
    scopeKey: `${userId ?? ''}:${workspaceId ?? ''}:${agentId}`,
    temporary: prefersTemporary,
  });
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

  return null;
});

SandboxStorageSectionInner.displayName = 'SandboxStorageSectionInner';

const SandboxStorageSection = memo<SandboxStorageSectionProps>(({ agentId }) => (
  <SafeBoundary minHeight={0} resetKeys={[agentId]}>
    <SandboxStorageSectionInner agentId={agentId} />
  </SafeBoundary>
));

SandboxStorageSection.displayName = 'SandboxStorageSection';

export default SandboxStorageSection;
