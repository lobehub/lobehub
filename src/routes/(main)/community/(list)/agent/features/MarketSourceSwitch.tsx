'use client';

import { type DropdownItem, type DropdownMenuCheckboxItem } from '@lobehub/ui';
import { Button, DropdownMenu, Icon } from '@lobehub/ui';
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

  type MarketSourceItem = Extract<DropdownItem, { type?: 'item' }> & {
    key: AssistantMarketSource;
    label: string;
  };

  const items = useMemo<MarketSourceItem[]>(
    () => [
      {
        key: 'new',
        label: t('assistants.marketSource.new'),
      },
      {
        key: 'legacy',
        label: t('assistants.marketSource.legacy'),
      },
    ],
    [t],
  );

  const handleChange = (value: AssistantMarketSource) => {
    router.push('/community/agent', {
      query: {
        page: null,
        source: value === 'new' ? null : value,
      },
    });
  };

  const menuItems = useMemo<DropdownMenuCheckboxItem[]>(
    () =>
      items.map(
        (item): DropdownMenuCheckboxItem => ({
          checked: item.key === currentSource,
          closeOnClick: true,
          key: item.key,
          label: item.label,
          onCheckedChange: (checked: boolean) => {
            if (checked) {
              handleChange(item.key);
            }
          },
          type: 'checkbox',
        }),
      ),
    [currentSource, handleChange, items],
  );

  return (
    <DropdownMenu items={menuItems} trigger="both">
      <Button icon={<Icon icon={Store} />} type={'text'}>
        {t('assistants.marketSource.label')}:{' '}
        {items.find((item) => item.key === currentSource)?.label}
        <Icon icon={ChevronDown} />
      </Button>
    </DropdownMenu>
  );
});

MarketSourceSwitch.displayName = 'MarketSourceSwitch';

export default MarketSourceSwitch;
