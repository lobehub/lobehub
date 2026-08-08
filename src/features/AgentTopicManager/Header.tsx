'use client';

import { Icon, Input } from '@lobehub/ui';
import { Search } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import NavHeader from '@/features/NavHeader';

import { useTopicsViewStore } from './store';

interface HeaderProps {
  agentId: string;
}

const Header = memo<HeaderProps>(({ agentId }) => {
  const { t } = useTranslation('topic');
  const search = useTopicsViewStore((s) => s.search);
  const setSearch = useTopicsViewStore((s) => s.setSearch);

  return (
    <NavHeader
      left={<AgentBreadcrumb agentId={agentId} title={t('management.title')} />}
      right={
        <Input
          placeholder={t('searchPlaceholder')}
          prefix={<Icon icon={Search} size={'small'} style={{ marginInlineEnd: 4 }} />}
          size={'small'}
          value={search}
          variant={'filled'}
          onChange={(e) => setSearch(e.target.value)}
        />
      }
      styles={{
        left: { paddingInlineStart: 8 },
        right: { flex: 1, maxWidth: 400 },
      }}
    />
  );
});

Header.displayName = 'AgentTopicManagerHeader';

export default Header;
