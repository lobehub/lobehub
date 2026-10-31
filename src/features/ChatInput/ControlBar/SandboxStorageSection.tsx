'use client';

import { memo, useEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SafeBoundary from '@/components/ErrorBoundary';
import {
  getPendingSandboxSelection,
  setPendingSandboxSelection,
  setSandboxDefaultSelection,
} from '@/store/chat/pendingSandboxSelection';

import { useTopicId } from '../hooks/useTopicId';
import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import SandboxDrivePicker from './SandboxDrivePicker';
import SandboxEnvironmentPicker from './SandboxEnvironmentPicker';
import { useSandboxPlacement } from './useSandboxPlacement';
import { useSandboxStorageAccess } from './useSandboxStorageAccess';

interface SandboxStorageSectionProps {
  agentId: string;
}

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
const useSeedDefaultSelection = (
  agentId: string,
  { eligible, entitled, hasTopic }: { eligible: boolean; entitled: boolean; hasTopic: boolean },
) => {
  const workspaceId = useActiveWorkspaceId();

  useEffect(() => {
    setSandboxDefaultSelection(
      agentId,
      eligible ? resolveDefaultSandboxSelection(workspaceId) : undefined,
    );
  }, [agentId, eligible, workspaceId]);

  useEffect(() => {
    if (!entitled || hasTopic || getPendingSandboxSelection(agentId)) return;

    setPendingSandboxSelection(agentId, resolveDefaultSandboxSelection(workspaceId));
  }, [agentId, entitled, hasTopic, workspaceId]);
};

/**
 * The working directory of a cloud-sandbox run — the counterpart of
 * `WorkingDirectorySection`, which covers runs on a machine, and shaped the
 * same way: one chip that always names the slot, whose menu holds every place
 * the run could work.
 *
 * Nothing chosen means a temporary sandbox, cleaned up with the session; a
 * folder on the drive keeps its files. A plan with a drive starts each new
 * conversation on its default folder rather than nothing. Beside it, the
 * environment the working directory is initialized from — a separate choice,
 * so a temporary sandbox can start from a checkout too.
 *
 * A plan without a drive still gets the chip: the temporary sandbox is
 * everyone's, and the way to a plan is a row in the same menu rather than a
 * different control.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { eligible, status } = useSandboxStorageAccess(agentId);
  const { selection, setSelection, topicId } = useSandboxPlacement(agentId, useTopicId());
  useSeedDefaultSelection(agentId, {
    eligible,
    entitled: status === 'ready',
    hasTopic: !!topicId,
  });

  if (status === 'hidden') return null;

  return (
    <>
      <SandboxDrivePicker
        entitled={status === 'ready'}
        topicId={topicId}
        value={selection}
        onChange={setSelection}
      />
      <SandboxEnvironmentPicker value={selection} onChange={setSelection} />
    </>
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
