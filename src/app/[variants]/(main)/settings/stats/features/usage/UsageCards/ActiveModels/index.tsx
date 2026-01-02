import { ModelIcon, ProviderIcon } from '@lobehub/icons';
import { ActionIcon, Flexbox, Modal } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { MaximizeIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { type UsageLog } from '@/types/usage/usageRecord';
import { formatNumber } from '@/utils/format';

import { GroupBy, type UsageChartProps } from '../../../../types';
import ModelTable from './ModelTable';

const computeList = (data: UsageLog[], groupBy: GroupBy): string[] => {
  if (!data || data?.length === 0) return [];

  return Array.from(
    data.reduce((acc, log) => {
      if (log.records) {
        for (const item of log.records) {
          if (groupBy === GroupBy.Model && item.model?.length !== 0) {
            acc.add(item.model);
          }
          if (groupBy === GroupBy.Provider && item.provider?.length !== 0) {
            acc.add(item.provider);
          }
        }
      }
      return acc;
    }, new Set<string>()),
  );
};

const ActiveModels = memo<UsageChartProps>(({ data, isLoading, groupBy }) => {
  const { t } = useTranslation('auth');

  const [open, setOpen] = useState(false);

  const iconList = useMemo(
    () => computeList(data || [], groupBy || GroupBy.Model),
    [data, groupBy],
  );

  return (
    <>
      <StatisticCard
        extra={
          <ActionIcon
            icon={MaximizeIcon}
            onClick={() => setOpen(true)}
            size={'small'}
            title={
              groupBy === GroupBy.Model
                ? t('usage.activeModels.modelTable')
                : t('usage.activeModels.providerTable')
            }
          />
        }
        key={groupBy}
        loading={isLoading}
        statistic={{
          description: (
            <Flexbox horizontal wrap={'wrap'}>
              {iconList.map((item, i) => {
                if (!item) return null;
                return groupBy === GroupBy.Model ? (
                  <ModelIcon
                    key={item}
                    model={item}
                    size={18}
                    style={{
                      border: `2px solid ${cssVar.colorBgContainer}`,
                      boxSizing: 'content-box',
                      marginRight: -8,
                      zIndex: i + 1,
                    }}
                  />
                ) : (
                  <ProviderIcon
                    key={item}
                    provider={item}
                    size={18}
                    style={{
                      border: `2px solid ${cssVar.colorBgContainer}`,
                      boxSizing: 'content-box',
                      marginRight: -8,
                      zIndex: i + 1,
                    }}
                  />
                );
              })}
            </Flexbox>
          ),
          precision: 0,
          value: formatNumber(iconList?.length ?? 0),
        }}
        title={
          <TitleWithPercentage
            title={
              groupBy === GroupBy.Model
                ? t('usage.activeModels.models')
                : t('usage.activeModels.providers')
            }
          />
        }
      />
      <Modal
        footer={null}
        onCancel={() => setOpen(false)}
        open={open}
        title={
          groupBy === GroupBy.Model
            ? t('usage.activeModels.modelTable')
            : t('usage.activeModels.providerTable')
        }
      >
        <ModelTable data={data} groupBy={groupBy} isLoading={isLoading} />
      </Modal>
    </>
  );
});

export default ActiveModels;
