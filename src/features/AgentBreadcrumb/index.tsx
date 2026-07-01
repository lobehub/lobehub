'use client';

import { Icon, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import urlJoin from 'url-join';

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
  const agentTitle = useAgentStore((s) => agentSelectors.getAgentMetaById(agentId)(s).title);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isInbox = !!inboxAgentId && agentId === inboxAgentId;
  const displayTitle = isInbox
    ? agentTitle || t('inbox.title', { ns: 'chat' })
    : agentTitle || t('defaultSession', { ns: 'common' });

  return (
    <AntBreadcrumb
      separator={<Icon icon={ChevronRight} size={14} />}
      items={[
        {
          title: (
            <Link to={urlJoin('/agent', agentId)}>
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
