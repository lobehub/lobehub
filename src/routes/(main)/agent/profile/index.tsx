'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, lazy, memo, Suspense } from 'react';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { delayed } from '@/components/Skeleton/Delayed';
import ProfileSkeleton from '@/components/Skeleton/Profile';
import AgentBuilder from '@/features/AgentBuilder';
import ItemDetailDock from '@/features/ProfileEditor/ItemDetailPanel';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import WideScreenContainer from '@/features/WideScreenContainer';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { StyleSheet } from '@/utils/styles';

import EditLockDriver from './features/EditLockDriver';
import Header from './features/Header';
import ProfileHydration from './features/ProfileHydration';
import ProfileProvider from './features/ProfileProvider';
import { selectors as profileSelectors, useProfileStore } from './features/store';
import { useClickToFocusEditor } from './features/useClickToFocusEditor';

const styles = StyleSheet.create({
  contentWrapper: {
    /**
     * Do not stretch the column to this scroller's height. A stretched column
     * stays viewport-tall while the editor overflows it, so CodeMirror picks it
     * as the nearest scrollable ancestor (`scrollHeight > clientHeight`) and
     * drag-selecting past the bottom edge scrolls nothing.
     */
    alignItems: 'flex-start',
    cursor: 'text',
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
  profileArea: {
    minWidth: 0,
  },
});

// One editor per route: the shell stays small and each page loads only its own editor.
const EngineEditor = lazy(() => import('./features/EngineEditor'));
const EnvironmentEditor = lazy(() => import('./features/EnvironmentEditor'));
const InstructionEditor = lazy(() => import('./features/InstructionEditor'));
const KnowledgeEditor = lazy(() => import('./features/KnowledgeEditor'));
const ProfileEditor = lazy(() => import('./features/ProfileEditor'));
const SkillsEditor = lazy(() => import('./features/SkillsEditor'));
const ToolsEditor = lazy(() => import('./features/ToolsEditor'));

/** Which page of the profile group the shell renders. They share one editing session. */
export type AgentProfileViewKey =
  'engine' | 'environment' | 'instruction' | 'knowledge' | 'profile' | 'skills' | 'tools';

const VIEWS: Record<AgentProfileViewKey, FC> = {
  engine: EngineEditor,
  environment: EnvironmentEditor,
  instruction: InstructionEditor,
  knowledge: KnowledgeEditor,
  profile: ProfileEditor,
  skills: SkillsEditor,
  tools: ToolsEditor,
};

const ProfileArea = memo<{ view: AgentProfileViewKey }>(({ view }) => {
  const View = VIEWS[view];
  const editor = useProfileStore((s) => s.editor);
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  // `isAgentConfigLoading` is data-presence ("no config in the map yet"), so a
  // *failed* config fetch keeps the map empty and would spin forever. The store
  // records the fetch error in `agentConfigErrorMap` — read it so failure shows a
  // reload state (via `retryAgentConfigFetch`) instead of a permanent skeleton.
  const configError = useAgentStore(agentSelectors.currentAgentConfigError);
  const retryAgentConfigFetch = useAgentStore((s) => s.retryAgentConfigFetch);
  const { allowed: canEdit } = usePermission('edit_own_content');
  const handleContentClick = useClickToFocusEditor(editor, canEdit);

  return (
    <>
      <Flexbox flex={1} height={'100%'} style={styles.profileArea}>
        <AsyncBoundary
          // Config lives in the map only after a successful fetch — so "settled"
          // is exactly "not still loading". A truthy sentinel on success lets the
          // error branch win over the loading branch when the fetch failed (the
          // map is empty in both, but the error should show, not the skeleton).
          data={isAgentConfigLoading ? undefined : true}
          error={configError}
          errorVariant={'page'}
          // `isAgentConfigLoading` is data-presence (empty map), true on error too;
          // gate on `!configError` so under loading→error precedence the loading
          // branch yields to the error state instead of spinning forever.
          isLoading={isAgentConfigLoading && !configError}
          loading={<ProfileSkeleton />}
          onRetry={() => retryAgentConfigFetch()}
        >
          <Header active={view} />
          <Flexbox
            horizontal
            height={'100%'}
            style={{ ...styles.contentWrapper, cursor: canEdit ? 'text' : 'default' }}
            width={'100%'}
            onClick={handleContentClick}
          >
            <WideScreenContainer>
              <Suspense fallback={<ProfileSkeleton />}>
                <View />
              </Suspense>
            </WideScreenContainer>
          </Flexbox>
        </AsyncBoundary>
      </Flexbox>
      {/* Mounted unconditionally (not behind the config-loading gate) so the lock
          is peeked on open and resolved before the editor renders. */}
      <EditLockDriver />
      <Suspense fallback={null}>
        <ProfileHydration />
      </Suspense>
    </>
  );
});
// Hide the Agent Builder while another member holds the edit lock (it drives
// updateAgentConfig, which the server rejects under the lock) and while the lock
// is still resolving — so it doesn't flash in then vanish once a lock is found.
const AgentBuilderSlot = memo(() => {
  const isHeterogeneous = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const lockedByOther = useProfileStore(profileSelectors.lockedByOther);
  const lockPending = useProfileStore(profileSelectors.lockPending);
  if (isHeterogeneous || lockedByOther || lockPending) return null;
  return <AgentBuilder />;
});

/**
 * Profile, Instruction, Knowledge, Engine, Environment, Tools and Skills are separate routes but one editing session: the same
 * lock, hydration, store and Agent Builder serve all three, so a prompt edited on
 * Context is the prompt the Builder sees from Profile.
 */
export const AgentProfileView = ({ view }: { view: AgentProfileViewKey }) => {
  const { aid } = useParams<{ aid: string }>();

  return (
    <Suspense fallback={delayed(<ProfileSkeleton />)}>
      <ResourceConfigAccessGate
        loading={<ProfileSkeleton />}
        redirectPath={`/agent/${aid ?? ''}`}
        resourceId={aid}
        resourceType="agent"
      >
        <ProfileProvider>
          <Flexbox horizontal height={'100%'} width={'100%'}>
            <ProfileArea view={view} />
            <ItemDetailDock />
            <AgentBuilderSlot />
          </Flexbox>
        </ProfileProvider>
      </ResourceConfigAccessGate>
    </Suspense>
  );
};

const AgentProfile: FC = () => <AgentProfileView view="profile" />;

export default AgentProfile;
