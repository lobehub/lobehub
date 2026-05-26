'use client';

import { Flexbox, Icon, Input, Segmented, Text } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { ChevronRight, LayoutGrid, List as ListIcon, Search } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
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
  const agentTitle = useAgentStore(agentSelectors.currentAgentTitle);
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const displayTitle = isInbox
    ? agentTitle || t('inbox.title', { ns: 'chat' })
    : agentTitle || t('defaultSession', { ns: 'common' });
  const viewMode = useTopicsViewStore((s) => s.viewMode);
  const setViewMode = useTopicsViewStore((s) => s.setViewMode);
  const search = useTopicsViewStore((s) => s.search);
  const setSearch = useTopicsViewStore((s) => s.setSearch);

  return (
    <NavHeader
      styles={{ center: { maxWidth: 560, paddingInline: 16 } }}
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
      right={
        <Flexbox horizontal align={'center'} gap={6}>
          <Segmented
            size={'small'}
            value={viewMode}
            variant={'borderless'}
            options={[
              {
                icon: <Icon icon={LayoutGrid} />,
                title: t('management.view.card'),
                value: 'card',
              },
              {
                icon: <Icon icon={ListIcon} />,
                title: t('management.view.list'),
                value: 'list',
              },
            ]}
            onChange={(v) => setViewMode(v as 'card' | 'list')}
          />
        </Flexbox>
      }
    >
      <Input
        placeholder={t('management.searchPlaceholder')}
        prefix={<Icon icon={Search} size={'small'} />}
        size={'middle'}
        value={search}
        variant={'filled'}
        onChange={(e) => setSearch(e.target.value)}
      />
    </NavHeader>
  );
});

Header.displayName = 'AgentTopicManagerHeader';

export default Header;
