'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { memo, Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentBuilder from '@/features/AgentBuilder';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { StyleSheet } from '@/utils/styles';

import Header from './features/Header';
import ProfileEditor from './features/ProfileEditor';
import ProfileHydration from './features/ProfileHydration';
import ProfileProvider from './features/ProfileProvider';
import { useProfileStore } from './features/store';

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
              style={styles.contentWrapper}
              width={'100%'}
              onClick={() => {
                editor?.focus();
              }}
            >
              <WideScreenContainer>
                <ProfileEditor />
              </WideScreenContainer>
            </Flexbox>
          </>
        )}
      </Flexbox>
      <Suspense fallback={null}>
        <ProfileHydration />
      </Suspense>
    </>
  );
});
const AgentProfile: FC = () => {
  return (
    <Suspense fallback={<Loading debugId="AgentProfile" />}>
      <ProfileProvider>
        <Flexbox horizontal height={'100%'} width={'100%'}>
          <ProfileArea />
          <AgentBuilder />
        </Flexbox>
      </ProfileProvider>
    </Suspense>
  );
};

export default AgentProfile;
