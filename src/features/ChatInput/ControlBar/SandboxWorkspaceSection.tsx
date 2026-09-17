'use client';

import { memo, useCallback } from 'react';

import SandboxWorkspaceUpsell from '@/business/client/features/SandboxWorkspaceUpsell';
import SafeBoundary from '@/components/ErrorBoundary';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import SandboxInstancePicker from './SandboxInstancePicker';
import { useSandboxWorkspaceAccess } from './useSandboxWorkspaceAccess';

interface SandboxWorkspaceSectionProps {
  agentId: string;
}

/**
 * Working directory for a run that executes in the cloud sandbox — the
 * counterpart of `WorkingDirectorySection`, which covers runs on a machine.
 *
 * Only one of the two is ever relevant to a given run, and each is gated on its
 * own execution target, so they never both appear.
 *
 * What the topic stores is a working COPY: a folder plus everything installed
 * into it. The packages a conversation installs belong to the folder it
 * installed them in, so two conversations that need separate files need
 * separate copies rather than separate folders under one.
 */
const SandboxWorkspaceSectionInner = memo<SandboxWorkspaceSectionProps>(({ agentId }) => {
  const { status } = useSandboxWorkspaceAccess(agentId);

  const topicId = useChatStore((s) => s.activeTopicId);
  const instanceId = useChatStore((s) => topicSelectors.currentTopicMetadata(s)?.sandboxInstanceId);
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  const handleChange = useCallback(
    async (selected: string | undefined) => {
      if (!topicId) return;

      // Choosing a working copy is also how a topic opts into persistence: a
      // user who picks where their files should live has said the files should
      // outlive the session.
      await updateTopicMetadata(topicId, {
        sandboxInstanceId: selected,
        sandboxMode: 'persistent',
      });
    },
    [topicId, updateTopicMetadata],
  );

  if (status === 'hidden') return null;
  if (status === 'upgrade') return <SandboxWorkspaceUpsell />;

  // A topic that has not been created yet has nothing to write the choice to.
  if (!topicId) return null;

  return <SandboxInstancePicker topicId={topicId} value={instanceId} onChange={handleChange} />;
});

SandboxWorkspaceSectionInner.displayName = 'SandboxWorkspaceSectionInner';

const SandboxWorkspaceSection = memo<SandboxWorkspaceSectionProps>(({ agentId }) => (
  <SafeBoundary minHeight={22} resetKeys={[agentId]}>
    <SandboxWorkspaceSectionInner agentId={agentId} />
  </SafeBoundary>
));

SandboxWorkspaceSection.displayName = 'SandboxWorkspaceSection';

export default SandboxWorkspaceSection;
