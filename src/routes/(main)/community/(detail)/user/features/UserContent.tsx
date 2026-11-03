'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import UserAgentList from './UserAgentList';
import UserGroupList from './UserGroupList';
import UserPluginList from './UserPluginList';
import UserSkillList from './UserSkillList';

const UserContent = memo(() => {
  return (
    <Flexbox gap={32}>
      <UserAgentList />
      <UserGroupList />
      <UserSkillList />
      <UserPluginList />
    </Flexbox>
  );
});

export default UserContent;
