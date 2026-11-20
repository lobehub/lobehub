import type { ItemType } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Icon, Text, TooltipGroup } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ArrowDownUpIcon, LucideCheck } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/selectors';
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

const DisabledModels = memo<DisabledModelsProps>(({ activeTab, providerId }) => {
  const { t } = useTranslation('modelProvider');

  const [sortType, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.disabledModelsSortType(s),
    s.updateSystemStatus,
  ]);

  // Only render at most PAGE_SIZE items on first paint and reveal more in
  // PAGE_SIZE steps as the user scrolls.
  const [visibleSize, setVisibleSize] = useState(PAGE_SIZE);

  const updateSortType = useCallback(
    (newSortType: SortType) => {
      updateSystemStatus({ disabledModelsSortType: newSortType });
    },
    [updateSystemStatus],
  );

  // The provider's model-list replica already holds every model (enabled and
  // disabled), so the section renders from it — painted from the persisted
  // copy on the first frame — and never refetches pages of the same rows.
  const disabledModels = useAiInfraStore(aiModelSelectors.disabledAiProviderModelList, isEqual);

  useEffect(() => {
    // reset visible window on provider change
    setVisibleSize(PAGE_SIZE);
  }, [providerId]);

  const sourceDisabledModels = useMemo(
    () => disabledModels.slice(0, visibleSize),
    [disabledModels, visibleSize],
  );

  const hasMore = visibleSize < disabledModels.length;

  const loadMoreRef = useRef<HTMLDivElement>(null);

  const triggerLoadMore = useCallback(() => {
    setVisibleSize((v) => Math.min(v + PAGE_SIZE, disabledModels.length));
  }, [disabledModels.length]);

  useEffect(() => {
    if (!hasMore) return;
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
  }, [hasMore, triggerLoadMore]);

  const shouldRenderSection = disabledModels.length > 0;

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
        <Flexbox horizontal align="center" justify="space-between">
          <Text style={{ fontSize: 12, marginTop: 8 }} type={'secondary'}>
            {t('providerModels.list.disabled')}
          </Text>
          {sourceDisabledModels.length > 1 && (
            <DropdownMenu
              items={
                [
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
                ] as ItemType[]
              }
            >
              <ActionIcon
                icon={ArrowDownUpIcon}
                size={'small'}
                title={t('providerModels.list.disabledActions.sort')}
              />
            </DropdownMenu>
          )}
        </Flexbox>
        <TooltipGroup>
          {displayModels.map((item) => (
            <ModelItem {...item} key={item.id} />
          ))}
        </TooltipGroup>

        <Flexbox horizontal align="center" justify="center" paddingBlock={8}>
          <div ref={loadMoreRef} style={{ height: 1, width: '0' }} />
        </Flexbox>
      </Flexbox>
    )
  );
});

export default DisabledModels;
