'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import { AgentNotFoundGuard } from '@/features/AgentNotFound';
import AgentSidebar from '@/features/AgentSidebar';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import AgentIdSync from '@/routes/(main)/agent/_layout/AgentIdSync';

/**
 * Owns the routed agent for every mobile `/agent/:aid/*` page: the chat (which
 * brings its own chat header) and the full-screen sub-pages (profile, docs,
 * topics, …, which bring their own page header). The desktop agent sidebar is
 * registered so those sub-pages can open it from their header.
 */
const AgentScopeLayout: FC = () => {
  useInitAgentConfig();

  return (
    <>
      <AgentSidebar />
      {/* Same 404 fallback as the desktop agent layout: only the content
          area collapses when the routed agent is gone or turned private. */}
      <AgentNotFoundGuard>
        <Outlet />
      </AgentNotFoundGuard>
      <AgentIdSync />
    </>
  );
};

export default AgentScopeLayout;
