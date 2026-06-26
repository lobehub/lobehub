'use client';

import { ModelIcon } from '@lobehub/icons';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { Table } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatNumber } from '@/utils/format';

import { type ModelUsageRow } from './hooks';

interface ModelBreakdownProps {
  isLoading?: boolean;
  rows: ModelUsageRow[];
}

const ModelBreakdown = memo<ModelBreakdownProps>(({ rows, isLoading }) => {
  const { t } = useTranslation('setting');

  const columns = [
    {
      dataIndex: 'model',
      key: 'model',
      render: (model: string, record: ModelUsageRow) => (
        <Flexbox horizontal align={'center'} gap={8}>
          <ModelIcon model={model} size={20} />
          <Flexbox>
            <Text ellipsis>{model}</Text>
            <Text fontSize={12} type={'secondary'}>
              {record.provider}
            </Text>
          </Flexbox>
        </Flexbox>
      ),
      title: t('usageStats.breakdown.model'),
    },
    {
      align: 'right' as const,
      dataIndex: 'requests',
      key: 'requests',
      render: (value: number) => formatNumber(value),
      title: t('usageStats.breakdown.requests'),
    },
    {
      align: 'right' as const,
      dataIndex: 'inputTokens',
      key: 'inputTokens',
      render: (value: number) => formatNumber(value),
      title: t('usageStats.breakdown.inputTokens'),
    },
    {
      align: 'right' as const,
      dataIndex: 'outputTokens',
      key: 'outputTokens',
      render: (value: number) => formatNumber(value),
      title: t('usageStats.breakdown.outputTokens'),
    },
    {
      align: 'right' as const,
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      render: (value: number) => formatNumber(value),
      title: t('usageStats.breakdown.totalTokens'),
    },
    {
      align: 'right' as const,
      dataIndex: 'spend',
      key: 'spend',
      render: (value: number) => `$${formatNumber(value, 2)}`,
      title: t('usageStats.breakdown.cost'),
    },
  ];

  return (
    <Block gap={16} variant={'borderless'}>
      <Text fontSize={16} weight={500}>
        {t('usageStats.breakdown.title')}
      </Text>
      <Table<ModelUsageRow>
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={false}
        rowKey={'key'}
        size={'middle'}
      />
    </Block>
  );
});

export default ModelBreakdown;
