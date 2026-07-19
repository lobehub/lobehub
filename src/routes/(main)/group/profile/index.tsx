'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { memo, Suspense } from 'react';
import { useParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import ResourceConfigAccessGate from '@/features/ResourcePermission/ResourceConfigAccessGate';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useGroupProfileStore } from '@/store/groupProfile';

import AgentBuilder from './features/AgentBuilder';
import GroupProfileSettings from './features/GroupProfile';
import Header from './features/Header';
import MemberProfile from './features/MemberProfile';
import StoreSync from './StoreSync';

const ProfileArea = memo(() => {
  const editor = useGroupProfileStore((s) => s.editor);
  const activeTabId = useGroupProfileStore((s) => s.activeTabId);
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
            horizontal
            height={'100%'}
            style={{ cursor: 'text', display: 'flex', overflowY: 'auto', position: 'relative' }}
            width={'100%'}
            onClick={() => {
              editor?.focus();
            }}
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
  const { gid } = useParams<{ gid: string }>();

  return (
    <Suspense fallback={<Loading debugId="GroupProfile" />}>
      <ResourceConfigAccessGate
        redirectPath={`/group/${gid ?? ''}`}
        resourceId={gid}
        resourceType="agentGroup"
      >
        <StoreSync />
        <Flexbox horizontal height={'100%'} width={'100%'}>
          <ProfileArea />
          <AgentBuilder />
        </Flexbox>
      </ResourceConfigAccessGate>
    </Suspense>
  );
};

export default GroupProfile;
