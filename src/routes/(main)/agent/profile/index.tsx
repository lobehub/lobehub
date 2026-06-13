'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentBuilder from '@/features/AgentBuilder';
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
  const { allowed: canEdit } = usePermission('edit_own_content');

  return (
    <>
      <Flexbox flex={1} height={'100%'} style={styles.profileArea}>
        {isAgentConfigLoading ? (
          <Loading debugId="ProfileArea" />
        ) : (
          <>
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
          </>
        )}
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
  const lockedByOther = useProfileStore(profileSelectors.lockedByOther);
  const lockPending = useProfileStore(profileSelectors.lockPending);
  if (lockedByOther || lockPending) return null;
  return <AgentBuilder />;
});

const AgentProfile: FC = () => {
  return (
    <Suspense fallback={<Loading debugId="AgentProfile" />}>
      <ProfileProvider>
        <Flexbox horizontal height={'100%'} width={'100%'}>
          <ProfileArea />
          <AgentBuilderSlot />
        </Flexbox>
      </ProfileProvider>
    </Suspense>
  );
};

export default AgentProfile;
