'use client';

import { memo } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import { useAgentStore } from '@/store/agent';

import { useTopicId } from '../hooks/useTopicId';
import SandboxDrivePicker from './SandboxDrivePicker';
import { useSandboxPlacement } from './useSandboxPlacement';
import { useSandboxStorageAccess } from './useSandboxStorageAccess';

interface SandboxStorageSectionProps {
  agentId: string;
}

/**
 * The working directory of a cloud-sandbox run — the counterpart of
 * `WorkingDirectorySection`, which covers runs on a machine, and shaped the
 * same way: one chip that always names the slot, whose menu holds every place
 * the run could work.
 *
 * Nothing chosen means a temporary sandbox, cleaned up with the session. A
 * folder on the drive keeps its files; an environment directory keeps what its
 * setup installed as well.
 *
 * A plan without a drive still gets the chip: the temporary sandbox is
 * everyone's, and the way to a plan is a row in the same menu rather than a
 * different control.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { status } = useSandboxStorageAccess(agentId);
  const { selection, setSelection, topicId } = useSandboxPlacement(agentId, useTopicId());
  const agentIsPublic = useAgentStore((s) => s.agentMap[agentId]?.visibility === 'public');

  if (status === 'hidden') return null;

  return (
    <SandboxDrivePicker
      agentIsPublic={agentIsPublic}
      entitled={status === 'ready'}
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
