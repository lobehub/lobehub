'use client';

import { memo } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';

import SandboxInstancePicker from './SandboxInstancePicker';
import { useSandboxMode } from './useSandboxMode';
import { useSandboxWorkspaceAccess } from './useSandboxWorkspaceAccess';

interface SandboxWorkspaceSectionProps {
  agentId: string;
}

/**
 * Which directory a persistent cloud-sandbox run keeps its files in — the
 * counterpart of `WorkingDirectorySection`, which covers runs on a machine.
 *
 * Whether files are kept at all is decided one control to the left, in the
 * execution-device menu, the way "Local sandbox" is decided there for a local
 * run. So this only appears once that switch is on: a throwaway box has no
 * directory to choose, and a chip for it would name a choice that does not
 * exist. The upgrade prompt for a plan without persistence lives on that same
 * menu row, not here.
 *
 * What the topic stores is an INSTANCE: a folder plus everything installed into
 * it. Two conversations that must not overwrite each other take two instances
 * rather than two folders under one.
 */
const SandboxWorkspaceSectionInner = memo<SandboxWorkspaceSectionProps>(({ agentId }) => {
  const { status } = useSandboxWorkspaceAccess(agentId);
  const { selection, setSelection, topicId } = useSandboxMode(agentId);

  if (status !== 'ready' || selection.mode !== 'persistent') return null;

  return <SandboxInstancePicker topicId={topicId} value={selection} onChange={setSelection} />;
});

SandboxWorkspaceSectionInner.displayName = 'SandboxWorkspaceSectionInner';

const SandboxWorkspaceSection = memo<SandboxWorkspaceSectionProps>(({ agentId }) => (
  <SafeBoundary minHeight={22} resetKeys={[agentId]}>
    <SandboxWorkspaceSectionInner agentId={agentId} />
  </SafeBoundary>
));

SandboxWorkspaceSection.displayName = 'SandboxWorkspaceSection';

export default SandboxWorkspaceSection;
