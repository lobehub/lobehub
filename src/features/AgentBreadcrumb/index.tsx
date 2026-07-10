'use client';

import { Icon, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import urlJoin from 'url-join';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import {
  buildPrefixedAgentRoutePath,
  parseAgentPathname,
} from '@/routes/(main)/agent/_layout/Sidebar/utils/agentPathname';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

interface AgentBreadcrumbProps {
  agentId: string;
  /**
   * The current section under the agent, e.g. 话题 / 助理档案 / 用量与成本.
   */
  title: ReactNode;
}

/**
 * Breadcrumb for pages that live under an agent: `<AgentName> › <Section>`.
 * The agent name links back to the agent home; the section is the current page.
 */
const AgentBreadcrumb = memo<AgentBreadcrumbProps>(({ agentId, title }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { pathname } = useLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const agentTitle = useAgentStore((s) => agentSelectors.getAgentMetaById(agentId)(s).title);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isInbox = !!inboxAgentId && agentId === inboxAgentId;
  const displayTitle = isInbox
    ? agentTitle || t('inbox.title', { ns: 'chat' })
    : agentTitle || t('defaultSession', { ns: 'common' });
  const agentRoute = useMemo(() => parseAgentPathname(pathname), [pathname]);
  const agentHomePath = useMemo(() => {
    const targetPath = buildWorkspaceAwarePath(urlJoin('/agent', agentId), activeWorkspaceSlug);
    return buildPrefixedAgentRoutePath(targetPath, agentRoute, activeWorkspaceSlug);
  }, [activeWorkspaceSlug, agentId, agentRoute]);

  return (
    <AntBreadcrumb
      separator={<Icon icon={ChevronRight} size={14} />}
      items={[
        {
          title: (
            <Link to={agentHomePath}>
              <Text ellipsis color={'inherit'} style={{ maxWidth: 200 }} weight={500}>
                {displayTitle}
              </Text>
            </Link>
          ),
        },
        {
          title: (
            <Text color={'inherit'} weight={500}>
              {title}
            </Text>
          ),
        },
      ]}
    />
  );
});

AgentBreadcrumb.displayName = 'AgentBreadcrumb';

export default AgentBreadcrumb;
