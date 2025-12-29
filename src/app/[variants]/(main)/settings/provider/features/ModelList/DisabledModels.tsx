import { ActionIcon, Dropdown, Flexbox, Icon, Text, TooltipGroup } from '@lobehub/ui';
import type { ItemType } from 'antd/es/menu/interface';
import { ArrowDownUpIcon, LucideCheck } from 'lucide-react';
import type { AiProviderModelListItem } from 'model-bank';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWRInfinite from 'swr/infinite';

import { aiModelService } from '@/services/aiModel';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import ModelItem from './ModelItem';

interface DisabledModelsProps {
  activeTab: string;
  providerId: string;
}

// Sort type enumeration
enum SortType {
  Alphabetical = 'alphabetical',
  AlphabeticalDesc = 'alphabeticalDesc',
  Default = 'default',
  ReleasedAt = 'releasedAt',
  ReleasedAtDesc = 'releasedAtDesc',
}

const PAGE_SIZE = 30;
const FETCH_DISABLED_MODELS_PAGE_KEY = 'FETCH_DISABLED_MODELS_PAGE';

const DisabledModels = memo<DisabledModelsProps>(({ activeTab, providerId }) => {
  const { t } = useTranslation(['modelProvider', 'common']);

  const [sortType, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.disabledModelsSortType(s),
    s.updateSystemStatus,
  ]);

  const updateSortType = useCallback(
    (newSortType: SortType) => {
      updateSystemStatus({ disabledModelsSortType: newSortType });
    },
    [updateSystemStatus],
  );

  const getKey = useCallback(
    (pageIndex: number, previousPageData: AiProviderModelListItem[] | null) => {
      if (!providerId) return null;
      if (previousPageData && previousPageData.length < PAGE_SIZE) return null;

      const offset = pageIndex * PAGE_SIZE;
      return [FETCH_DISABLED_MODELS_PAGE_KEY, providerId, offset] as const;
    },
    [providerId],
  );

  const {
    data: pages,
    error,
    isValidating,
    setSize,
    size,
  } = useSWRInfinite<AiProviderModelListItem[]>(getKey, async ([, id, offset]) => {
    return aiModelService.getAiProviderModelList(id as string, {
      enabled: false,
      limit: PAGE_SIZE,
      offset: offset as number,
    });
  });

  const pagedDisabledModels = useMemo(() => (pages ? pages.flat() : []), [pages]);
  const isInitialLoading = !pages && !error;
  const isReachingEnd = !!pages && pages.length > 0 && pages.at(-1).length < PAGE_SIZE;
  const isLoadingMore = isValidating && size > 0 && !!pages && pages.length < size;

  const loadMoreRef = useRef<HTMLDivElement>(null);

  const triggerLoadMore = useCallback(() => {
    if (isReachingEnd) return;
    if (isValidating) return;
    setSize(size + 1);
  }, [isReachingEnd, isValidating, setSize, size]);

  useEffect(() => {
    if (isReachingEnd) return;
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          triggerLoadMore();
        });
      },
      {
        rootMargin: '200px',
        threshold: 0.01,
      },
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [isReachingEnd, triggerLoadMore]);

  const sourceDisabledModels = pagedDisabledModels;

  const shouldRenderSection = isInitialLoading || sourceDisabledModels.length > 0;

  // Filter models based on active tab
  const filteredDisabledModels = useMemo(() => {
    if (activeTab === 'all') return sourceDisabledModels;
    return sourceDisabledModels.filter((model) => model.type === activeTab);
  }, [activeTab, sourceDisabledModels]);

  // Sort models based on sort type
  const sortedDisabledModels = useMemo(() => {
    const models = [...filteredDisabledModels];
    switch (sortType) {
      case SortType.Alphabetical: {
        return models.sort((a, b) => {
          const cmpDisplay = (a.displayName || a.id).localeCompare(b.displayName || b.id);
          if (cmpDisplay !== 0) return cmpDisplay;
          return a.id.localeCompare(b.id);
        });
      }
      case SortType.AlphabeticalDesc: {
        return models.sort((a, b) => {
          const cmpDisplay = (b.displayName || b.id).localeCompare(a.displayName || a.id);
          if (cmpDisplay !== 0) return cmpDisplay;
          return b.id.localeCompare(a.id);
        });
      }
      case SortType.ReleasedAt: {
        return models.sort((a, b) => {
          const aHasDate = !!a.releasedAt;
          const bHasDate = !!b.releasedAt;

          if (aHasDate && !bHasDate) return -1;
          if (!aHasDate && bHasDate) return 1;
          if (!aHasDate && !bHasDate) return 0;

          return a.releasedAt!.localeCompare(b.releasedAt!);
        });
      }
      case SortType.ReleasedAtDesc: {
        return models.sort((a, b) => {
          const aHasDate = !!a.releasedAt;
          const bHasDate = !!b.releasedAt;

          if (aHasDate && !bHasDate) return -1;
          if (!aHasDate && bHasDate) return 1;
          if (!aHasDate && !bHasDate) return 0;

          return b.releasedAt!.localeCompare(a.releasedAt!);
        });
      }
      case SortType.Default: {
        return models;
      }
      default: {
        return models;
      }
    }
  }, [filteredDisabledModels, sortType]);

  const displayModels = sortedDisabledModels;

  return (
    shouldRenderSection && (
      <Flexbox>
        <Flexbox align="center" horizontal justify="space-between">
          <Text style={{ fontSize: 12, marginTop: 8 }} type={'secondary'}>
            {t('providerModels.list.disabled')}
          </Text>
          {sourceDisabledModels.length > 1 && (
            <Dropdown
              menu={{
                items: [
                  {
                    icon: sortType === SortType.Default ? <Icon icon={LucideCheck} /> : <div />,
                    key: 'default',
                    label: t('providerModels.list.disabledActions.sortDefault'),
                    onClick: () => updateSortType(SortType.Default),
                  },
                  {
                    type: 'divider',
                  },
                  {
                    icon:
                      sortType === SortType.Alphabetical ? <Icon icon={LucideCheck} /> : <div />,
                    key: 'alphabetical',
                    label: t('providerModels.list.disabledActions.sortAlphabetical'),
                    onClick: () => updateSortType(SortType.Alphabetical),
                  },
                  {
                    icon:
                      sortType === SortType.AlphabeticalDesc ? (
                        <Icon icon={LucideCheck} />
                      ) : (
                        <div />
                      ),
                    key: 'alphabeticalDesc',
                    label: t('providerModels.list.disabledActions.sortAlphabeticalDesc'),
                    onClick: () => updateSortType(SortType.AlphabeticalDesc),
                  },
                  {
                    type: 'divider',
                  },
                  {
                    icon: sortType === SortType.ReleasedAt ? <Icon icon={LucideCheck} /> : <div />,
                    key: 'releasedAt',
                    label: t('providerModels.list.disabledActions.sortReleasedAt'),
                    onClick: () => updateSortType(SortType.ReleasedAt),
                  },
                  {
                    icon:
                      sortType === SortType.ReleasedAtDesc ? <Icon icon={LucideCheck} /> : <div />,
                    key: 'releasedAtDesc',
                    label: t('providerModels.list.disabledActions.sortReleasedAtDesc'),
                    onClick: () => updateSortType(SortType.ReleasedAtDesc),
                  },
                ] as ItemType[],
              }}
              trigger={['click']}
            >
              <ActionIcon
                icon={ArrowDownUpIcon}
                size={'small'}
                title={t('providerModels.list.disabledActions.sort')}
              />
            </Dropdown>
          )}
        </Flexbox>
        <TooltipGroup>
          {displayModels.map((item) => (
            <ModelItem {...item} key={item.id} />
          ))}
        </TooltipGroup>

        <Flexbox align="center" horizontal justify="center" paddingBlock={8}>
          <div ref={loadMoreRef} style={{ height: 1, width: '0' }} />
          {(isInitialLoading || isLoadingMore) && (
            <Text style={{ fontSize: 12, marginTop: 4 }} type={'secondary'}>
              {t('common:loading')}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    )
  );
});

export default DisabledModels;
