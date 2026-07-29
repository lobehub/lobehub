'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { memo, Suspense } from 'react';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentBuilder from '@/features/AgentBuilder';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import WideScreenContainer from '@/features/WideScreenContainer';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { StyleSheet } from '@/utils/styles';

import EditLockDriver from './features/EditLockDriver';
import Header from './features/Header';
import ProfileEditor from './features/ProfileEditor';
import ProfileHydration from './features/ProfileHydration';
import ProfileProvider from './features/ProfileProvider';
import { selectors as profileSelectors, useProfileStore } from './features/store';

const styles = StyleSheet.create({
  contentWrapper: {
    cursor: 'text',
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
  profileArea: {
    minWidth: 0,
  },
});

const ProfileArea = memo(() => {
  const editor = useProfileStore((s) => s.editor);
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  // `isAgentConfigLoading` is data-presence ("no config in the map yet"), so a
  // *failed* config fetch keeps the map empty and would spin forever. The store
  // records the fetch error in `agentConfigErrorMap` — read it so failure shows a
  // reload state (via `retryAgentConfigFetch`) instead of a permanent skeleton.
  const configError = useAgentStore(agentSelectors.currentAgentConfigError);
  const retryAgentConfigFetch = useAgentStore((s) => s.retryAgentConfigFetch);
  const { allowed: canEdit } = usePermission('edit_own_content');

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
          loading={<Loading debugId="ProfileArea" />}
          onRetry={() => retryAgentConfigFetch()}
        >
          <Header />
          <Flexbox
            horizontal
            height={'100%'}
            style={{ ...styles.contentWrapper, cursor: canEdit ? 'text' : 'default' }}
            width={'100%'}
            onClick={(e) => {
              if (!canEdit) return;
              // Only focus editor for clicks within this DOM element,
              // not from React portal (e.g. Modal) whose DOM is outside this tree
              if (e.currentTarget.contains(e.target as Node)) {
                editor?.focus();
              }
            }}
          >
            <WideScreenContainer>
              <ProfileEditor />
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

const AgentProfile: FC = () => {
  const { aid } = useParams<{ aid: string }>();

  return (
    <Suspense fallback={<Loading debugId="AgentProfile" />}>
      <ResourceConfigAccessGate
        redirectPath={`/agent/${aid ?? ''}`}
        resourceId={aid}
        resourceType="agent"
      >
        <ProfileProvider>
          <Flexbox horizontal height={'100%'} width={'100%'}>
            <ProfileArea />
            <AgentBuilderSlot />
          </Flexbox>
        </ProfileProvider>
      </ResourceConfigAccessGate>
    </Suspense>
  );
};

export default AgentProfile;
