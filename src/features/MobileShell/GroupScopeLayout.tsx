'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import GroupIdSync from '@/routes/(main)/group/_layout/GroupIdSync';
import GroupSidebar from '@/routes/(main)/group/_layout/Sidebar';

/**
 * The group counterpart of {@link AgentScopeLayout}: chat and sub-pages share
 * it; the 404 guard sits below each header.
 */
const GroupScopeLayout: FC = () => {
  useInitGroupConfig();

  return (
    <>
      <GroupSidebar />
      <Outlet />
      <GroupIdSync />
    </>
  );
};

export default GroupScopeLayout;
