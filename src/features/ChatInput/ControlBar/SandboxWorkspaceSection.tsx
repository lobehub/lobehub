'use client';

import { memo } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import { useAgentStore } from '@/store/agent';

import SandboxInstancePicker from './SandboxInstancePicker';
import { useSandboxMode } from './useSandboxMode';
import { useSandboxWorkspaceAccess } from './useSandboxWorkspaceAccess';

interface SandboxWorkspaceSectionProps {
  agentId: string;
}

/**
 * The working directory of a cloud-sandbox run — the counterpart of
 * `WorkingDirectorySection`, which covers runs on a machine, and shaped the
 * same way: one chip that always names the slot, whose menu holds every place
 * the run could keep its files.
 *
 * Nothing chosen means a temporary directory, cleaned up with the sandbox. The
 * persistent choices are an environment's instances: a folder plus everything
 * installed into it, so two conversations that must not overwrite each other
 * take two instances. A persistent run always lives in one, as in Codex — the
 * server's root fallback exists for a deleted instance, not as a choice.
 *
 * A plan without persistence still gets the chip: the temporary directory is
 * everyone's, and the way to a plan is a row in the same menu rather than a
 * different control.
 */
const SandboxWorkspaceSectionInner = memo<SandboxWorkspaceSectionProps>(({ agentId }) => {
  const { status } = useSandboxWorkspaceAccess(agentId);
  const { selection, setSelection, topicId } = useSandboxMode(agentId);
  const agentIsPublic = useAgentStore((s) => s.agentMap[agentId]?.visibility === 'public');

  if (status === 'hidden') return null;

  return (
    <SandboxInstancePicker
      agentIsPublic={agentIsPublic}
      entitled={status === 'ready'}
      topicId={topicId}
      value={selection}
      onChange={setSelection}
    />
  );
});

SandboxWorkspaceSectionInner.displayName = 'SandboxWorkspaceSectionInner';

const SandboxWorkspaceSection = memo<SandboxWorkspaceSectionProps>(({ agentId }) => (
  <SafeBoundary minHeight={22} resetKeys={[agentId]}>
    <SandboxWorkspaceSectionInner agentId={agentId} />
  </SafeBoundary>
));

SandboxWorkspaceSection.displayName = 'SandboxWorkspaceSection';

export default SandboxWorkspaceSection;
