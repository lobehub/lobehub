'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import UserAgentList from './UserAgentList';
import UserFavoriteAgents from './UserFavoriteAgents';
import UserFavoritePlugins from './UserFavoritePlugins';
import UserGroupList from './UserGroupList';

const UserContent = memo(() => {
  return (
    <Flexbox gap={32}>
      <UserAgentList />
      <UserGroupList />
      <UserFavoriteAgents />
      <UserFavoritePlugins />
    </Flexbox>
  );
});

export default UserContent;
