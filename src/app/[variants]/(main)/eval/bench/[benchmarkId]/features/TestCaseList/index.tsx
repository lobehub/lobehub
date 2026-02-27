'use client';

import { Flexbox, Tag } from '@lobehub/ui';
import { Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEvalStore } from '@/store/eval';

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
        <Typography.Text ellipsis style={{ maxWidth: 400 }}>
          {text}
        </Typography.Text>
      ),
      title: t('table.columns.input'),
      width: 400,
    },
    {
      dataIndex: ['metadata', 'difficulty'],
      key: 'difficulty',
      render: (difficulty: string) =>
        difficulty ? <Tag>{t(`difficulty.${difficulty}` as any)}</Tag> : '-',
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
