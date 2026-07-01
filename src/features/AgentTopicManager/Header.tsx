'use client';

import { Icon, Input, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { ChevronRight, Search } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import urlJoin from 'url-join';

import NavHeader from '@/features/NavHeader';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';

import { useTopicsViewStore } from './store';

interface HeaderProps {
  agentId: string;
}

const Header = memo<HeaderProps>(({ agentId }) => {
  const { t } = useTranslation(['topic', 'chat', 'common']);
  const agentTitle = useAgentStore((s) => agentSelectors.getAgentMetaById(agentId)(s).title);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isInbox = !!inboxAgentId && agentId === inboxAgentId;
  const displayTitle = isInbox
    ? agentTitle || t('inbox.title', { ns: 'chat' })
    : agentTitle || t('defaultSession', { ns: 'common' });
  const search = useTopicsViewStore((s) => s.search);
  const setSearch = useTopicsViewStore((s) => s.setSearch);

  return (
    <NavHeader
      styles={{ center: { maxWidth: 560, paddingInline: 16 }, left: { paddingInlineStart: 24 } }}
      left={
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
                  {t('management.title')}
                </Text>
              ),
            },
          ]}
        />
      }
    >
      <Input
        placeholder={t('management.searchPlaceholder')}
        prefix={<Icon icon={Search} size={'small'} style={{ marginInlineEnd: 4 }} />}
        size={'small'}
        value={search}
        variant={'filled'}
        onChange={(e) => setSearch(e.target.value)}
      />
    </NavHeader>
  );
});

Header.displayName = 'AgentTopicManagerHeader';

export default Header;
