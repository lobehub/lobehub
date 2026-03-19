import { ProviderIcon } from '@lobehub/icons';
import { Flexbox, Tag, Text, Tooltip } from '@lobehub/ui';
import { type TableColumnType } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { getPrice } from '@/features/Conversation/Messages/components/Extras/Usage/UsageDetail/pricing';
import { parseAsInteger, useQueryParam } from '@/hooks/useQueryParam';
import { useClientDataSWR } from '@/libs/swr';
import { usageService } from '@/services/usage';
import { useAiInfraStore } from '@/store/aiInfra';
import { formatDate, formatNumber } from '@/utils/format';

import { type UsageChartProps } from '../../types';

const UsageTable = memo<UsageChartProps>(({ dateStrings, isAdminView }) => {
  const { t } = useTranslation('auth');

  const { data, isLoading, mutate } = useClientDataSWR(
    isAdminView ? 'usage-logs-admin' : 'usage-logs',
    async () =>
      isAdminView
        ? usageService.adminFindByMonth(dateStrings)
        : usageService.findByMonth(dateStrings),
  );

  const builtinModels = useAiInfraStore((s) => s.builtinAiModelList);

  const [currentPage, setCurrentPage] = useQueryParam('current', parseAsInteger.withDefault(1), {
    clearOnDefault: true,
  });
  const [pageSize, setPageSize] = useQueryParam('pageSize', parseAsInteger.withDefault(5), {
    clearOnDefault: true,
  });

  useEffect(() => {
    if (dateStrings) {
      mutate();
    }
  }, [dateStrings]);

  const columns: TableColumnType<any>[] = [
    {
      hidden: true,
      key: 'id',
      title: 'ID',
    },
    {
      dataIndex: 'model',
      key: 'model',
      render: (value, record) => (
        <Flexbox horizontal align={'start'} gap={16}>
          <ProviderIcon
            provider={record.provider}
            size={18}
            style={{
              border: `2px solid ${cssVar.colorBgContainer}`,
              boxSizing: 'content-box',
              marginRight: -8,
            }}
          />
          <Tooltip title={value}>
            <Text>{value?.length > 12 ? `${value.slice(0, 12)}...` : value}</Text>
          </Tooltip>
        </Flexbox>
      ),
      title: t('usage.table.model'),
    },
    {
      dataIndex: 'type',
      filters: [
        {
          text: 'Chat',
          value: 'chat',
        },
      ],
      key: 'type',
      onFilter: (value, record) => record.callType === value,
      render: (value) => {
        return <Tag>{value}</Tag>;
      },
      title: t('usage.table.type'),
    },
    {
      dataIndex: 'totalInputTokens',
      key: 'inputTokens',
      title: t('usage.table.inputTokens'),
    },
    {
      dataIndex: 'totalOutputTokens',
      key: 'outputTokens',
      title: t('usage.table.outputTokens'),
    },
    {
      dataIndex: 'tps',
      key: 'tps',
      render: (value) => formatNumber(value, 2),
      title: t('usage.table.tps'),
    },
    {
      dataIndex: 'ttft',
      key: 'ttft',
      render: (value) => formatNumber(value / 1000, 2),
      title: t('usage.table.ttft'),
    },
    {
      dataIndex: 'spend',
      key: 'spend',
      render: (value) => {
        return `$${formatNumber(value, 6)}`;
      },
      title: t('usage.table.spend'),
    },
    {
      key: 'pricing',
      render: (_, record) => {
        const modelCard = builtinModels.find(
          (m) => m.id === record.model && m.providerId === record.provider,
        );
        if (!modelCard?.pricing) return '-';
        const price = getPrice(modelCard.pricing);
        return (
          <Tooltip title={`Output: $${price.output} / 1M`}>
            <span style={{ cursor: 'default' }}>{`$${price.input} / $${price.output}`}</span>
          </Tooltip>
        );
      },
      title: t('usage.table.pricing'),
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value) => {
        return formatDate(new Date(value));
      },
      sortDirections: ['descend'],
      sorter: (a, b) => a.createdAt - b.createdAt,
      title: t('usage.table.createdAt'),
    },
  ];

  return (
    <InlineTable
      columns={columns}
      dataSource={data}
      loading={isLoading}
      rowKey={(record) => record.id || `${record.model}-${record.createdAt}-${record.provider}`}
      size="small"
      pagination={{
        current: currentPage,
        onChange: (page) => {
          setCurrentPage(page);
        },
        onShowSizeChange: (current, size) => {
          setCurrentPage(current);
          setPageSize(size);
        },
        pageSize,
      }}
    />
  );
});

export default UsageTable;
