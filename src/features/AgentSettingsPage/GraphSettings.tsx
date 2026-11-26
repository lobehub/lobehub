'use client';

import { Navigate } from 'react-router';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentGraphRuntime from '@/features/AgentSetting/AgentGraphRuntime';
import { useUserStore } from '@/store/user';

import { useAgentGraphSupported } from './useAgentGraphSupported';

/** A deep link is the only way here without the option, so send it to a page that exists. */
const GraphSettings = () => {
  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const supported = useAgentGraphSupported();

  // The Labs switch reads as off until the user state lands.
  if (!isUserStateInit) return <SurfaceSkeleton header={false} variant={'form'} />;
  if (!supported) return <Navigate replace relative={'path'} to={'../opening'} />;

  return <AgentGraphRuntime />;
};

export default GraphSettings;
