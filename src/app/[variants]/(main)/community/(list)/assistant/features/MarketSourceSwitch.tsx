'use client';

import { Dropdown, type DropdownMenuItemType, Icon , Button } from '@lobehub/ui';
import { ChevronDown, Store } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuery } from '@/hooks/useQuery';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { type AssistantMarketSource } from '@/types/discover';

const MarketSourceSwitch = memo(() => {
  const { t } = useTranslation('discover');
  const router = useQueryRoute();
  const query = useQuery() as { source?: AssistantMarketSource };
  const currentSource = (query.source as AssistantMarketSource) ?? 'new';

  const items = useMemo(
    () =>
      [
        {
          key: 'new',
          label: t('assistants.marketSource.new'),
        },
        {
          key: 'legacy',
          label: t('assistants.marketSource.legacy'),
        },
      ] satisfies DropdownMenuItemType[],
    [t],
  );

  const handleChange = (value: AssistantMarketSource) => {
    router.push('/community/assistant', {
      query: {
        page: null,
        source: value === 'new' ? null : value,
      },
    });
  };

  return (
    <Dropdown
      menu={{
        // @ts-expect-error 等待 antd 修复
        activeKey: currentSource,
        items,
        onClick: ({ key }) => handleChange(key as AssistantMarketSource),
      }}
      trigger={['click', 'hover']}
    >
      <Button icon={<Icon icon={Store} />} type={'text'}>
        {t('assistants.marketSource.label')}:{' '}
        {items.find((item) => item.key === currentSource)?.label}
        <Icon icon={ChevronDown} />
      </Button>
    </Dropdown>
  );
});

MarketSourceSwitch.displayName = 'MarketSourceSwitch';

export default MarketSourceSwitch;
