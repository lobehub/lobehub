'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Badge, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { cssVar } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

const DIFFICULTY_COLORS: Record<string, { bg: string; color: string }> = {
  easy: { bg: cssVar.colorSuccessBg, color: cssVar.colorSuccess },
  hard: { bg: cssVar.colorErrorBg, color: cssVar.colorError },
  medium: { bg: cssVar.colorWarningBg, color: cssVar.colorWarning },
};

interface TestCaseListProps {
  datasetId: string;
}

const TestCaseList = memo<TestCaseListProps>(({ datasetId }) => {
  const { t } = useTranslation('eval');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });

  const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);

  const { data: testCaseData, isLoading: loading } = useFetchTestCases({
    datasetId,
    limit: pagination.pageSize,
    offset: (pagination.current - 1) * pagination.pageSize,
  });

  const data = testCaseData?.data || [];
  const total = testCaseData?.total || 0;

  const columns: ColumnsType<any> = [
    {
      dataIndex: ['content', 'input'],
      ellipsis: true,
      key: 'input',
      render: (text: string) => (
        <Text ellipsis style={{ maxWidth: 400 }}>
          {text}
        </Text>
      ),
      title: t('table.columns.input'),
      width: 400,
    },
    {
      dataIndex: ['metadata', 'difficulty'],
      key: 'difficulty',
      render: (difficulty: string) => {
        if (!difficulty) return '-';
        const c = DIFFICULTY_COLORS[difficulty] || DIFFICULTY_COLORS.easy;
        return (
          <Badge
            style={{ backgroundColor: c.bg, borderColor: c.color + '30', color: c.color }}
          >
            {t(`difficulty.${difficulty}` as any)}
          </Badge>
        );
      },
      title: t('table.columns.difficulty'),
      width: 100,
    },
  ];

  return (
    <Flexbox gap={12}>
      <Table
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        size="small"
        pagination={{
          current: pagination.current,
          onChange: (page, pageSize) => setPagination({ current: page, pageSize }),
          pageSize: pagination.pageSize,
          total,
        }}
      />
    </Flexbox>
  );
});

export default TestCaseList;
