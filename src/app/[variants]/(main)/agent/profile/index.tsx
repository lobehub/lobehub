'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, Suspense, memo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentBuilder from '@/features/AgentBuilder';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import Header from './features/Header';
import ProfileEditor from './features/ProfileEditor';
import ProfileHydration from './features/ProfileHydration';
import ProfileProvider from './features/ProfileProvider';
import { useProfileStore } from './features/store';

const ProfileArea = memo(() => {
  const editor = useProfileStore((s) => s.editor);
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);

  return (
    <>
      <Flexbox flex={1} height={'100%'}>
        {isAgentConfigLoading ? (
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
const AgentProfile: FC = () => {
  return (
    <Suspense fallback={<Loading debugId="AgentProfile" />}>
      <ProfileProvider>
        <Flexbox height={'100%'} horizontal width={'100%'}>
          <ProfileArea />
          <AgentBuilder />
        </Flexbox>
      </ProfileProvider>
    </Suspense>
  );
};

export default AgentProfile;
