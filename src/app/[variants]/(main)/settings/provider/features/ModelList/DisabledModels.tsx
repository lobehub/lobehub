import { ActionIcon, Button, Dropdown, Icon, Text } from '@lobehub/ui';
import { Tooltip } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import isEqual from 'fast-deep-equal';
import { ArrowDownUpIcon, ChevronDown, CircleAlert, LucideCheck } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useAiInfraStore } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import ModelItem from './ModelItem';

interface DisabledModelsProps {
  activeTab: string;
}

// Sort type enumeration
enum SortType {
  Alphabetical = 'alphabetical',
  AlphabeticalDesc = 'alphabeticalDesc',
  Default = 'default',
  ReleasedAt = 'releasedAt',
  ReleasedAtDesc = 'releasedAtDesc',
}

const DisabledModels = memo<DisabledModelsProps>(({ activeTab }) => {
  const { t } = useTranslation('modelProvider');

  const [showMore, setShowMore] = useState(false);
  const [showMoreUnavailable, setShowMoreUnavailable] = useState(false);

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

  const disabledModels = useAiInfraStore(aiModelSelectors.disabledAiProviderModelList, isEqual);
  const unavailableModels = useAiInfraStore(
    aiModelSelectors.unavailableAiProviderModelList,
    isEqual,
  );

  // Filter models based on active tab
  const filteredDisabledModels = useMemo(() => {
    if (activeTab === 'all') return disabledModels;
    return disabledModels.filter((model) => model.type === activeTab);
  }, [disabledModels, activeTab]);

  const filteredUnavailableModels = useMemo(() => {
    if (activeTab === 'all') return unavailableModels;
    return unavailableModels.filter((model) => model.type === activeTab);
  }, [unavailableModels, activeTab]);

  // Sort function
  const sortModels = useCallback(
    (models: typeof disabledModels) => {
      const sorted = [...models];
      switch (sortType) {
        case SortType.Alphabetical: {
          return sorted.sort((a, b) => {
            const cmpDisplay = (a.displayName || a.id).localeCompare(b.displayName || b.id);
            if (cmpDisplay !== 0) return cmpDisplay;
            return a.id.localeCompare(b.id);
          });
        }
        case SortType.AlphabeticalDesc: {
          return sorted.sort((a, b) => {
            const cmpDisplay = (b.displayName || b.id).localeCompare(a.displayName || a.id);
            if (cmpDisplay !== 0) return cmpDisplay;
            return b.id.localeCompare(a.id);
          });
        }
        case SortType.ReleasedAt: {
          return sorted.sort((a, b) => {
            const aHasDate = !!a.releasedAt;
            const bHasDate = !!b.releasedAt;

            if (aHasDate && !bHasDate) return -1;
            if (!aHasDate && bHasDate) return 1;
            if (!aHasDate && !bHasDate) return 0;

            return a.releasedAt!.localeCompare(b.releasedAt!);
          });
        }
        case SortType.ReleasedAtDesc: {
          return sorted.sort((a, b) => {
            const aHasDate = !!a.releasedAt;
            const bHasDate = !!b.releasedAt;

            if (aHasDate && !bHasDate) return -1;
            if (!aHasDate && bHasDate) return 1;
            if (!aHasDate && !bHasDate) return 0;

            return b.releasedAt!.localeCompare(a.releasedAt!);
          });
        }
        default: {
          return sorted;
        }
      }
    },
    [sortType],
  );

  const sortedDisabledModels = useMemo(
    () => sortModels(filteredDisabledModels),
    [filteredDisabledModels, sortModels],
  );

  const sortedUnavailableModels = useMemo(
    () => sortModels(filteredUnavailableModels),
    [filteredUnavailableModels, sortModels],
  );

  const displayModels = showMore ? sortedDisabledModels : sortedDisabledModels.slice(0, 10);
  const displayUnavailableModels = showMoreUnavailable
    ? sortedUnavailableModels
    : sortedUnavailableModels.slice(0, 10);

  const sortDropdownMenu = useMemo(
    () => ({
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
          icon: sortType === SortType.Alphabetical ? <Icon icon={LucideCheck} /> : <div />,
          key: 'alphabetical',
          label: t('providerModels.list.disabledActions.sortAlphabetical'),
          onClick: () => updateSortType(SortType.Alphabetical),
        },
        {
          icon: sortType === SortType.AlphabeticalDesc ? <Icon icon={LucideCheck} /> : <div />,
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
          icon: sortType === SortType.ReleasedAtDesc ? <Icon icon={LucideCheck} /> : <div />,
          key: 'releasedAtDesc',
          label: t('providerModels.list.disabledActions.sortReleasedAtDesc'),
          onClick: () => updateSortType(SortType.ReleasedAtDesc),
        },
      ] as ItemType[],
    }),
    [sortType, t, updateSortType],
  );

  const hasDisabledModels = filteredDisabledModels.length > 0;
  const hasUnavailableModels = filteredUnavailableModels.length > 0;

  if (!hasDisabledModels && !hasUnavailableModels) return null;

  return (
    <Flexbox gap={16}>
      {/* Disabled models section */}
      {hasDisabledModels && (
        <Flexbox>
          <Flexbox align="center" horizontal justify="space-between">
            <Text style={{ fontSize: 12, marginTop: 8 }} type={'secondary'}>
              {t('providerModels.list.disabled')}
            </Text>
            {filteredDisabledModels.length > 1 && (
              <Dropdown menu={sortDropdownMenu} trigger={['click']}>
                <ActionIcon
                  icon={ArrowDownUpIcon}
                  size={'small'}
                  title={t('providerModels.list.disabledActions.sort')}
                />
              </Dropdown>
            )}
          </Flexbox>
          {displayModels.map((item) => (
            <ModelItem {...item} key={item.id} />
          ))}
          {!showMore && sortedDisabledModels.length > 10 && (
            <Button
              block
              icon={ChevronDown}
              onClick={() => {
                setShowMore(true);
              }}
              size={'small'}
            >
              {t('providerModels.list.disabledActions.showMore')}
            </Button>
          )}
        </Flexbox>
      )}

      {/* Unavailable models section */}
      {hasUnavailableModels && (
        <Flexbox>
          <Flexbox align="center" horizontal justify="space-between">
            <Flexbox align="center" gap={4} horizontal>
              <Text style={{ fontSize: 12, marginTop: 8 }} type={'secondary'}>
                {t('providerModels.list.unavailable')}
              </Text>
              <Tooltip title={t('providerModels.list.unavailableTooltip')}>
                <Icon icon={CircleAlert} size={'small'} style={{ color: 'orange', marginTop: 8 }} />
              </Tooltip>
            </Flexbox>
            {filteredUnavailableModels.length > 1 && (
              <Dropdown menu={sortDropdownMenu} trigger={['click']}>
                <ActionIcon
                  icon={ArrowDownUpIcon}
                  size={'small'}
                  title={t('providerModels.list.disabledActions.sort')}
                />
              </Dropdown>
            )}
          </Flexbox>
          {displayUnavailableModels.map((item) => (
            <ModelItem {...item} key={item.id} />
          ))}
          {!showMoreUnavailable && sortedUnavailableModels.length > 10 && (
            <Button
              block
              icon={ChevronDown}
              onClick={() => {
                setShowMoreUnavailable(true);
              }}
              size={'small'}
            >
              {t('providerModels.list.disabledActions.showMore')}
            </Button>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default DisabledModels;
