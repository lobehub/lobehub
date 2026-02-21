import { CategoryBar, useThemeColorRange } from '@lobehub/charts';
import { ModelIcon, ProviderIcon } from '@lobehub/icons';
import { Collapse, Flexbox, Skeleton, Tag } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { type UsageLog } from '@/types/usage/usageRecord';
import { formatPrice } from '@/utils/format';

import { type UsageChartProps } from '../../../../types';
import { GroupBy } from '../../../../types';

interface WeightGroup {
  id: string;
  spend: number | string;
  weight: number;
}

const formatData = (
  data: UsageLog[],
  groupBy: GroupBy,
): {
  childrens: WeightGroup[];
  id: string;
  totalSpend: number;
}[] => {
  if (!data || data?.length === 0) return [];

  const requestLogs = data.flatMap((log) => log.records);
  const groupedLogs = requestLogs.reduce((acc, log) => {
    const key = groupBy === GroupBy.Model ? log.model : log.provider;
    if (!acc.has(key)) {
      acc.set(key, []);
    }
    acc.get(key)?.push(log);
    return acc;
  }, new Map<string, UsageLog['records']>());

  return Array.from(groupedLogs.entries())
    .map(([key, logs]) => {
      // 此处的 logs 为多日的 log，需要进行 sum
      // 如果当前的 groupBy 是 Model，则 logs 应该按照 Provider 进行分组
      const spend = logs.reduce((acc, log) => {
        const key = groupBy === GroupBy.Model ? log.provider : log.model;
        acc.set(key, (acc.get(key) || 0) + log.spend);
        return acc;
      }, new Map<string, number>());

      const totalSpend = logs.reduce((total, log) => total + (log.spend || 0), 0);

      const spendWithWeight = Array.from(
        spend.entries().map(([key, value]) => {
          return {
            id: key,
            spend: value,
            weight: totalSpend > 0 ? value / totalSpend : 0,
          };
        }),
      );

      return {
        childrens: spendWithWeight.sort((a, b) => b.weight - a.weight),
        id: key,
        totalSpend: totalSpend,
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
};

const ModelTable = memo<UsageChartProps>(({ data, isLoading, groupBy }) => {
  const { t } = useTranslation('auth');
  const themeColorRange = useThemeColorRange();

  const formattedData = useMemo(
    () => formatData(data || [], groupBy || GroupBy.Model),
    [data, groupBy],
  );

  return isLoading ? (
    <Skeleton active paragraph={{ rows: 8 }} title={false} />
  ) : (
    <Collapse
      defaultActiveKey={formattedData.map((item) => item.id)}
      expandIconPlacement={'end'}
      gap={16}
      items={formattedData.map((item) => {
        const key = item.id;
        return {
          children: (
            <Flexbox>
              <CategoryBar
                colors={themeColorRange}
                showLabels={false}
                size={2}
                values={item.childrens.map((item) => item.weight)}
              />
              <InlineTable
                dataSource={item.childrens}
                hoverToActive={false}
                loading={isLoading}
                rowKey={(record) => record.id}
                columns={[
                  {
                    dataIndex: 'id',
                    key: 'id',
                    render: (value, record, index) => {
                      return (
                        <Flexbox horizontal align={'center'} gap={12} key={value}>
                          {groupBy === GroupBy.Provider ? (
                            <ProviderIcon
                              provider={record.id}
                              style={{
                                boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}, 0 0 0 4px ${themeColorRange[index]}`,
                                boxSizing: 'content-box',
                              }}
                            />
                          ) : (
                            <ModelIcon
                              model={record.id}
                              style={{
                                boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}, 0 0 0 4px ${themeColorRange[index]}`,
                                boxSizing: 'content-box',
                              }}
                            />
                          )}
                          {value}
                        </Flexbox>
                      );
                    },
                    title:
                      groupBy === GroupBy.Model
                        ? t('usage.activeModels.table.provider')
                        : t('usage.activeModels.table.model'),
                    width: 200,
                  },
                  {
                    dataIndex: 'spend',
                    key: 'spend',
                    render: (value) => {
                      return `$${formatPrice(value)}`;
                    },
                    title: t('usage.activeModels.table.spend'),
                  },
                ]}
              />
            </Flexbox>
          ),
          extra: <Tag>{item?.childrens?.length ?? 0}</Tag>,
          key,
          label: (
            <Flexbox horizontal align={'center'} gap={8}>
              {groupBy === GroupBy.Model ? (
                <ModelIcon model={key} size={24} />
              ) : (
                <ProviderIcon provider={key} size={24} />
              )}
              {key}
            </Flexbox>
          ),
        };
      })}
      padding={{
        body: 0,
      }}
    />
  );
});

export default ModelTable;
