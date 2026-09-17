'use client';

import { memo, useCallback } from 'react';
import useSWR from 'swr';

import SandboxWorkspaceUpsell from '@/business/client/features/SandboxWorkspaceUpsell';
import SafeBoundary from '@/components/ErrorBoundary';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import SandboxDirectoryPicker from './SandboxDirectoryPicker';
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
 * What the topic actually stores is a working COPY, not a path: the packages a
 * conversation installs belong to the directory it installed them in, so two
 * conversations that need separate files need separate copies rather than
 * separate folders under one. The person picks a folder, which is the part of
 * that they have an opinion about; the copy is looked up or made for them.
 */
const SandboxWorkspaceSectionInner = memo<SandboxWorkspaceSectionProps>(({ agentId }) => {
  const { status } = useSandboxWorkspaceAccess(agentId);

  const topicId = useChatStore((s) => s.activeTopicId);
  const instanceId = useChatStore((s) => topicSelectors.currentTopicMetadata(s)?.sandboxInstanceId);
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);

  // Reads the database only, so it settles before the picker is ever opened.
  // `listInstances` would answer this too, at the cost of a sandbox cold start
  // to fetch sizes nothing here shows.
  const { data: instance } = useSWR(
    instanceId ? ['sandbox-instance', instanceId] : null,
    ([, id]) => sandboxWorkspaceService.getInstance({ id }),
  );

  const handleChange = useCallback(
    async (path: string | undefined) => {
      if (!topicId) return;

      // Choosing a directory is also how a topic opts into persistence: a user
      // who picks where their files should live has said the files should
      // outlive the session.
      if (!path) {
        await updateTopicMetadata(topicId, {
          sandboxInstanceId: undefined,
          sandboxMode: 'persistent',
        });
        return;
      }

      const selected = await sandboxWorkspaceService.useInstanceAtDirectory({
        workingDirectory: path,
      });
      await updateTopicMetadata(topicId, {
        sandboxInstanceId: selected.id,
        sandboxMode: 'persistent',
      });
    },
    [topicId, updateTopicMetadata],
  );

  if (status === 'hidden') return null;
  if (status === 'upgrade') return <SandboxWorkspaceUpsell />;

  // A topic that has not been created yet has nothing to write the choice to.
  if (!topicId) return null;

  return (
    <SandboxDirectoryPicker
      topicId={topicId}
      value={instance?.workingDirectory}
      onChange={handleChange}
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
