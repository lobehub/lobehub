'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router';

import { AgentNotFoundGuard } from '@/features/AgentNotFound';

import MobilePageLayout from './PageLayout';

/** Full-screen agent sub-pages (profile, docs, …) with the agent 404 fallback. */
const MobileAgentPagesLayout: FC = () => (
  <MobilePageLayout>
    <AgentNotFoundGuard>
      <Outlet />
    </AgentNotFoundGuard>
  </MobilePageLayout>
);

export default MobileAgentPagesLayout;
