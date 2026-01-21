'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useUserDetailContext } from './DetailProvider';
import UserAgentList from './UserAgentList';
import UserFavoriteAgents from './UserFavoriteAgents';
import UserFavoritePlugins from './UserFavoritePlugins';
import UserForkedAgentGroups from './UserForkedAgentGroups';
import UserForkedAgents from './UserForkedAgents';
import UserGroupList from './UserGroupList';

const UserContent = memo(() => {
  const { forkedAgents, forkedAgentGroups } = useUserDetailContext();

  return (
    <Flexbox gap={32}>
      <UserAgentList />
      <UserGroupList />
      <UserForkedAgents agents={forkedAgents} />
      <UserForkedAgentGroups agentGroups={forkedAgentGroups} />
      <UserFavoriteAgents />
      <UserFavoritePlugins />
    </Flexbox>
  );
});

export default UserContent;
