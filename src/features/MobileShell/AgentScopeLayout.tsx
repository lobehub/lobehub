'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import AgentSidebar from '@/features/AgentSidebar';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import AgentIdSync from '@/routes/(main)/agent/_layout/AgentIdSync';

/**
 * Owns the routed agent for every mobile `/agent/:aid/*` page: the chat (which
 * brings its own chat header) and the full-screen sub-pages (profile, docs,
 * topics, …, which bring their own page header). The desktop agent sidebar is
 * registered so those sub-pages can open it from their header. The 404 guard
 * sits below each header (chat layout, page layout) so a missing agent keeps
 * the way back.
 */
const AgentScopeLayout: FC = () => {
  useInitAgentConfig();

  return (
    <>
      <AgentSidebar />
      <Outlet />
      <AgentIdSync />
    </>
  );
};

export default AgentScopeLayout;
