'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, Suspense, memo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import AgentBuilder from './features/AgentBuilder';
import Header from './features/Header';
import ProfileEditor from './features/ProfileEditor';
import ProfileHydration from './features/ProfileHydration';
import ProfileProvider from './features/ProfileProvider';
import { useProfileStore } from './features/store';

const ProfileArea = memo(() => {
  const editor = useProfileStore((s) => s.editor);
  const isGroupsLoading = useAgentGroupStore(agentGroupSelectors.isGroupsInit);

  return (
    <>
      <Flexbox flex={1} height={'100%'}>
        {isGroupsLoading ? (
          <Loading debugId="ProfileArea" />
        ) : (
          <>
            <Header />
            <Flexbox
              height={'100%'}
              horizontal
              onClick={() => {
                editor?.focus();
              }}
              style={{ cursor: 'text', display: 'flex', overflowY: 'auto', position: 'relative' }}
              width={'100%'}
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

const GroupProfile: FC = () => {
  return (
    <Suspense fallback={<Loading debugId="GroupProfile" />}>
      <ProfileProvider>
        <Flexbox height={'100%'} horizontal width={'100%'}>
          <ProfileArea />
          <AgentBuilder />
        </Flexbox>
      </ProfileProvider>
    </Suspense>
  );
};

export default GroupProfile;
