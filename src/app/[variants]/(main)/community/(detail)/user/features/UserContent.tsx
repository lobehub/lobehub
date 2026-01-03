'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import UserAgentList from './UserAgentList';
import UserFavoriteAgents from './UserFavoriteAgents';
import UserFavoritePlugins from './UserFavoritePlugins';

const UserContent = memo(() => {
  return (
    <Flexbox gap={32}>
      <UserAgentList />
      <UserFavoriteAgents />
      <UserFavoritePlugins />
    </Flexbox>
  );
});

export default UserContent;
