'use client';

import { memo, useCallback, useReducer } from 'react';

import SandboxWorkspaceUpsell from '@/business/client/features/SandboxWorkspaceUpsell';
import SafeBoundary from '@/components/ErrorBoundary';
import { useChatStore } from '@/store/chat';
import {
  getPendingSandboxSelection,
  setPendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';
import { topicSelectors } from '@/store/chat/selectors';

import type { SandboxSelection } from './SandboxInstancePicker';
import SandboxInstancePicker from './SandboxInstancePicker';
import { useSandboxWorkspaceAccess } from './useSandboxWorkspaceAccess';

interface SandboxWorkspaceSectionProps {
  agentId: string;
}

/**
 * Which environment instance a run that executes in the cloud sandbox uses —
 * the counterpart of `WorkingDirectorySection`, which covers runs on a machine.
 *
 * Only one of the two is ever relevant to a given run, and each is gated on its
 * own execution target, so they never both appear.
 *
 * What the topic stores is an INSTANCE: a folder plus everything installed into
 * it. The packages a conversation installs belong to the folder it installed
 * them in, so two conversations that need separate files need separate
 * instances rather than separate folders under one.
 *
 * A topic that does not exist yet has nothing to write the choice to, which is
 * the state every conversation starts in — so the choice is buffered by agent
 * and carried by the first send instead of the picker disappearing. Hiding it
 * there meant someone who enabled the feature and picked the cloud sandbox saw
 * nothing at all, with no way to tell a missing entitlement from a missing
 * conversation.
 */
const SandboxWorkspaceSectionInner = memo<SandboxWorkspaceSectionProps>(({ agentId }) => {
  const { status } = useSandboxWorkspaceAccess(agentId);

  const topicId = useChatStore((s) => s.activeTopicId);
  const topicInstanceId = useChatStore(
    (s) => topicSelectors.currentTopicMetadata(s)?.sandboxInstanceId,
  );
  // Absent means ephemeral — the server reads it the same way
  // (`sandboxMode !== 'persistent'`), so the chip must say so rather than leave
  // the state unnamed.
  const topicMode = useChatStore((s) => topicSelectors.currentTopicMetadata(s)?.sandboxMode);
  const updateTopicMetadata = useChatStore((s) => s.updateTopicMetadata);
  // The pending value lives outside React, so a write to it has to ask for the
  // re-render that a store write would have given us.
  const [, rerender] = useReducer((tick: number) => tick + 1, 0);

  const handleChange = useCallback(
    async (selection: SandboxSelection) => {
      if (!topicId) {
        setPendingSandboxSelection(agentId, selection);
        rerender();
        return;
      }

      // Written whole, both fields every time. Deriving the mode from "did they
      // pick an instance" is what made this a one-way switch: nothing could then
      // express "keep nothing", so a conversation that once touched this menu
      // could never go back to a throwaway box.
      await updateTopicMetadata(topicId, {
        sandboxInstanceId: selection.instanceId,
        sandboxMode: selection.mode,
      });
    },
    [agentId, topicId, updateTopicMetadata],
  );

  if (status === 'hidden') return null;
  if (status === 'upgrade') return <SandboxWorkspaceUpsell />;

  const value: SandboxSelection = topicId
    ? { instanceId: topicInstanceId, mode: topicMode === 'persistent' ? 'persistent' : 'ephemeral' }
    : (getPendingSandboxSelection(agentId) ?? { mode: 'ephemeral' });

  return (
    <SandboxInstancePicker topicId={topicId ?? undefined} value={value} onChange={handleChange} />
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
