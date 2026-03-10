import { type DropdownItem, type DropdownMenuCheckboxItem } from '@lobehub/ui';
import { Button, DropdownMenu, Icon } from '@lobehub/ui';
import { ArrowDownWideNarrow, ChevronDown } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { usePathname, useQuery } from '@/libs/router/navigation';
import {
  AssistantSorts,
  DiscoverTab,
  McpSorts,
  ModelSorts,
  PluginSorts,
  ProviderSorts,
} from '@/types/discover';

const SortButton = memo(() => {
  const { t } = useTranslation('discover');
  const pathname = usePathname();
  const { sort } = useQuery();
  const router = useQueryRoute();
  const activeTab = useMemo(() => pathname.split('community/')[1] as DiscoverTab, [pathname]);
  type SortItem = Extract<DropdownItem, { type?: 'item' }> & {
    key: string;
  };

  const items = useMemo<SortItem[]>(() => {
    switch (activeTab) {
      case DiscoverTab.Assistants: {
        return [
          {
            key: AssistantSorts.Recommended,
            label: t('assistants.sorts.recommended'),
          },
          {
            key: AssistantSorts.UpdatedAt,
            label: t('assistants.sorts.updatedAt'),
          },
          {
            key: AssistantSorts.MostUsage,
            label: t('assistants.sorts.mostUsage'),
          },
          {
            key: AssistantSorts.HaveSkills,
            label: t('assistants.sorts.haveSkills'),
          },
        ];
      }
      case DiscoverTab.Plugins: {
        return [
          {
            key: PluginSorts.CreatedAt,
            label: t('plugins.sorts.createdAt'),
          },
          {
            key: PluginSorts.Title,
            label: t('plugins.sorts.title'),
          },
          {
            key: PluginSorts.Identifier,
            label: t('plugins.sorts.identifier'),
          },
        ];
      }
      case DiscoverTab.Models: {
        return [
          {
            key: ModelSorts.ReleasedAt,
            label: t('models.sorts.releasedAt'),
          },
          {
            key: ModelSorts.Identifier,
            label: t('models.sorts.identifier'),
          },
          {
            key: ModelSorts.ContextWindowTokens,
            label: t('models.sorts.contextWindowTokens'),
          },
          {
            key: ModelSorts.InputPrice,
            label: t('models.sorts.inputPrice'),
          },
          {
            key: ModelSorts.OutputPrice,
            label: t('models.sorts.outputPrice'),
          },
          {
            key: ModelSorts.ProviderCount,
            label: t('models.sorts.providerCount'),
          },
        ];
      }
      case DiscoverTab.Providers: {
        return [
          {
            key: ProviderSorts.Default,
            label: t('providers.sorts.default'),
          },
          {
            key: ProviderSorts.Identifier,
            label: t('providers.sorts.identifier'),
          },
          {
            key: ProviderSorts.ModelCount,
            label: t('providers.sorts.modelCount'),
          },
        ];
      }
      case DiscoverTab.Mcp: {
        return [
          {
            key: McpSorts.Recommended,
            label: t('mcp.sorts.recommended'),
          },
          {
            key: McpSorts.IsFeatured,
            label: t('mcp.sorts.isFeatured'),
          },
          {
            key: McpSorts.IsValidated,
            label: t('mcp.sorts.isValidated'),
          },
          {
            key: McpSorts.InstallCount,
            label: t('mcp.sorts.installCount'),
          },
          {
            key: McpSorts.RatingCount,
            label: t('mcp.sorts.ratingCount'),
          },
          {
            key: McpSorts.UpdatedAt,
            label: t('mcp.sorts.updatedAt'),
          },
          {
            key: McpSorts.CreatedAt,
            label: t('mcp.sorts.createdAt'),
          },
        ];
      }
      default: {
        return [];
      }
    }
  }, [t, activeTab]);

  const activeItem = useMemo<SortItem | undefined>(() => {
    if (sort) {
      const findItem = items.find((item) => String(item.key) === sort);
      if (findItem) return findItem;
    }
    return items[0];
  }, [items, sort]);

  const handleSort = (config: string) => {
    router.push(pathname, { query: { sort: config } });
  };

  const menuItems = useMemo<DropdownMenuCheckboxItem[]>(
    () =>
      items.map(
        (item): DropdownMenuCheckboxItem => ({
          checked: item.key === activeItem?.key,
          closeOnClick: true,
          key: item.key,
          label: item.label,
          onCheckedChange: (checked: boolean) => {
            if (checked) {
              handleSort(String(item.key));
            }
          },
          type: 'checkbox',
        }),
      ),
    [activeItem?.key, handleSort, items],
  );

  if (menuItems.length === 0) return null;

  return (
    <DropdownMenu items={menuItems} trigger="both">
      <Button data-testid="sort-dropdown" icon={<Icon icon={ArrowDownWideNarrow} />} type={'text'}>
        {activeItem?.label ?? menuItems[0]?.label}
        <Icon icon={ChevronDown} />
      </Button>
    </DropdownMenu>
  );
});

export default SortButton;
