'use client';

import { memo } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';

import { useTopicId } from '../hooks/useTopicId';
import SandboxDrivePicker from './SandboxDrivePicker';
import SandboxEnvironmentPicker from './SandboxEnvironmentPicker';
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
 * Nothing chosen means a temporary sandbox, cleaned up with the session; a
 * folder on the drive keeps its files. Beside it, the environment the working
 * directory is initialized from — a separate choice, so a temporary sandbox
 * can start from a checkout too.
 *
 * A plan without a drive still gets the chip: the temporary sandbox is
 * everyone's, and the way to a plan is a row in the same menu rather than a
 * different control.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { status } = useSandboxStorageAccess(agentId);
  const { selection, setSelection, topicId } = useSandboxPlacement(agentId, useTopicId());

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
