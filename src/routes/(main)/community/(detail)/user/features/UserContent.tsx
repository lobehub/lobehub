'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import UserAgentList from './UserAgentList';
import UserGroupList from './UserGroupList';

const UserContent = memo(() => {
  return (
    <Flexbox gap={32}>
      <UserAgentList />
      <UserGroupList />
    </Flexbox>
  );
});

export default UserContent;
