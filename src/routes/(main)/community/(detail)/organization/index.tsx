'use client';

import { memo, useEffect, useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { useCommunityWorkspaceProfile } from '@/business/client/hooks/useCommunityWorkspaceProfile';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDiscoverStore } from '@/store/discover';

import NotFound from '../components/NotFound';
import { resolveWorkspaceCommunityProfileRedirect } from '../workspace/features/resolveWorkspaceProfileEdit';
import { OrganizationDetailProvider } from './features/DetailProvider';
import OrganizationHeader from './features/Header';
import OrganizationContent from './features/OrganizationContent';
import Loading from './loading';

interface OrganizationDetailPageProps {
  mobile?: boolean;
}

const OrganizationDetailPage = memo<OrganizationDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>();
  const location = useLocation();
  const username = decodeURIComponent(params.slug ?? '');
  const navigate = useWorkspaceAwareNavigate();
  const { isWorkspaceScope } = useCommunityWorkspaceProfile();

  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const { data, isLoading } = useUserProfile({ username });

  useEffect(() => {
    const redirectTo = resolveWorkspaceCommunityProfileRedirect({
      isWorkspaceScope,
      pathname: location.pathname,
      search: location.search,
    });
    if (redirectTo) navigate(redirectTo, { replace: true });
  }, [isWorkspaceScope, location.pathname, location.search, navigate]);

  const contextConfig = useMemo(() => {
    if (!data?.user || data.user.type !== 'organization') return null;
    const { user, agents, agentGroups, skills, plugins } = data;
    const totalInstalls = agents.reduce((sum, agent) => sum + (agent.installCount || 0), 0);

    return {
      agentCount: agents.length,
      agentGroups: agentGroups || [],
      agents,
      groupCount: agentGroups?.length || 0,
      mobile,
      plugins: plugins || [],
      skills: skills || [],
      totalInstalls,
      user,
    };
  }, [data, mobile]);

  if (isLoading) return <Loading />;
  if (!contextConfig) return <NotFound />;

  return (
    <OrganizationDetailProvider config={contextConfig}>
      <OrganizationHeader />
      <OrganizationContent />
    </OrganizationDetailProvider>
  );
});

export const MobileOrganizationDetailPage = memo(() => {
  return <OrganizationDetailPage mobile={true} />;
});

export default OrganizationDetailPage;
