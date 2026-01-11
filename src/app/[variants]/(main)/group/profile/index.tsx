'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, Suspense, memo } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import AgentBuilder from './features/AgentBuilder';
import GroupProfileSettings from './features/GroupProfile';
import Header from './features/Header';
import MemberProfile from './features/MemberProfile';
import ProfileHydration from './features/ProfileHydration';
import { useProfileStore } from './store';

const ProfileArea = memo(() => {
  const editor = useProfileStore((s) => s.editor);
  const activeTabId = useProfileStore((s) => s.activeTabId);
  const isGroupsLoading = useAgentGroupStore(agentGroupSelectors.isGroupsInit);

  const isGroupTab = activeTabId === 'group';

  return (
    <Flexbox flex={1} height={'100%'} style={{ minWidth: 0, overflow: 'hidden' }}>
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
              {isGroupTab ? <GroupProfileSettings /> : <MemberProfile />}
            </WideScreenContainer>
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

const GroupProfile: FC = () => {
  return (
    <Suspense fallback={<Loading debugId="GroupProfile" />}>
      <ProfileHydration />
      <Flexbox height={'100%'} horizontal width={'100%'}>
        <ProfileArea />
        <AgentBuilder />
      </Flexbox>
    </Suspense>
  );
};

export default GroupProfile;
