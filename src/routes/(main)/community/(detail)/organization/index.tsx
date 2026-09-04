'use client';

import { memo, useEffect, useMemo } from 'react';

import { useCommunityWorkspaceProfile } from '@/business/client/hooks/useCommunityWorkspaceProfile';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useParams } from '@/libs/router/navigation';
import { useDiscoverStore } from '@/store/discover';
import { routerSelectors, useRouterStore } from '@/store/router';

import NotFound from '../components/NotFound';
import { resolveWorkspaceCommunityProfileRedirect } from '../workspace/features/resolveWorkspaceProfileEdit';
import { OrganizationDetailProvider } from './features/DetailProvider';
import OrganizationHeader from './features/Header';
import OrganizationContent from './features/OrganizationContent';

interface OrganizationDetailPageProps {
  mobile?: boolean;
}

const OrganizationDetailPage = memo<OrganizationDetailPageProps>(({ mobile }) => {
  const params = useParams<{ slug: string }>('slug');
  const pathname = useRouterStore(routerSelectors.pathname);
  const search = useRouterStore(routerSelectors.search);
  const username = decodeURIComponent(params.slug ?? '');
  const navigate = useWorkspaceAwareNavigate();
  const { isWorkspaceScope } = useCommunityWorkspaceProfile();

  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const { data } = useUserProfile({ username });

  useEffect(() => {
    const redirectTo = resolveWorkspaceCommunityProfileRedirect({
      isWorkspaceScope,
      pathname,
      search,
    });
    if (redirectTo) navigate(redirectTo, { replace: true });
  }, [isWorkspaceScope, navigate, pathname, search]);

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
  if (!contextConfig) return <NotFound />;

  return (
    <OrganizationDetailProvider config={contextConfig}>
      <OrganizationHeader />
      <OrganizationContent />
    </OrganizationDetailProvider>
  );
});

export const MobileOrganizationDetailPage = () => {
  return <OrganizationDetailPage mobile={true} />;
};

export default OrganizationDetailPage;
