'use client';

import { Flexbox } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { Badge, Button, Checkbox, Skeleton, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type FC, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

type ResumableCase = Awaited<ReturnType<typeof agentEvalService.getResumableCases>>[number];

const StatusLabel = memo<{ status: string | null | undefined }>(({ status }) => {
  const { t } = useTranslation('eval');
  if (status === 'error') return <Badge color="orange" text={t('table.filter.error')} />;
  if (status === 'timeout') return <Badge color="orange" text={t('run.status.timeout')} />;
  return <Tag>{status}</Tag>;
});

export interface BatchResumeContentProps {
  onConfirm: (targets: Array<{ testCaseId: string; threadId?: string }>) => Promise<void>;
  runId: string;
}

const BatchResumeContent: FC<BatchResumeContentProps> = ({ onConfirm, runId }) => {
  const { t } = useTranslation('eval');
  const { t: tc } = useTranslation('common');
  const { close } = useModalContext();
  const [cases, setCases] = useState<ResumableCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setLoading(true);
    agentEvalService
      .getResumableCases(runId)
      .then((data) => {
        setCases(data);
        setSelectedIds(data.filter((c) => c.canResume).map((c) => c.testCaseId));
      })
      .finally(() => setLoading(false));
  }, [runId]);

  const resumableCases = useMemo(() => cases.filter((c) => c.canResume), [cases]);
  const allSelected = selectedIds.length === resumableCases.length && resumableCases.length > 0;
  const indeterminate = selectedIds.length > 0 && selectedIds.length < resumableCases.length;

  const handleToggleAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? resumableCases.map((c) => c.testCaseId) : []);
    },
    [resumableCases],
  );

  const handleToggleRow = useCallback((testCaseId: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, testCaseId] : prev.filter((id) => id !== testCaseId),
    );
  }, []);

  const columns: ColumnsType<ResumableCase> = useMemo(
    () => [
      {
        key: 'select',
        render: (_: any, record: ResumableCase) => (
          <Tooltip title={record.canResume ? undefined : record.reason}>
            <Checkbox
              checked={selectedIds.includes(record.testCaseId)}
              disabled={!record.canResume}
              onChange={(e) => handleToggleRow(record.testCaseId, e.target.checked)}
            />
          </Tooltip>
        ),
        title: (
          <Checkbox
            checked={allSelected}
            disabled={resumableCases.length === 0}
            indeterminate={indeterminate}
            onChange={(e) => handleToggleAll(e.target.checked)}
          />
        ),
        width: 48,
      },
      {
        key: 'index',
        render: (_: any, record: ResumableCase) => (
          <span
            style={{
              color: 'var(--ant-color-text-tertiary)',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            {record.sortOrder ?? '-'}
          </span>
        ),
        title: '#',
        width: 48,
      },
      {
        key: 'input',
        render: (_: any, record: ResumableCase) => (
          <Typography.Paragraph
            ellipsis={{ expandable: true, rows: 2, symbol: '...' }}
            style={{ margin: 0 }}
          >
            {record.input}
          </Typography.Paragraph>
        ),
        title: t('table.columns.input'),
      },
      {
        key: 'status',
        render: (_: any, record: ResumableCase) => (
          <Tooltip title={record.canResume ? undefined : record.reason}>
            <StatusLabel status={record.resumeStatus} />
          </Tooltip>
        ),
        title: t('table.columns.status'),
        width: 110,
      },
    ],
    [t, selectedIds, allSelected, indeterminate, resumableCases, handleToggleRow, handleToggleAll],
  );

  const handleConfirm = async () => {
    if (selectedIds.length === 0) return;
    setConfirming(true);
    try {
      await onConfirm(
        cases
          .filter((item) => selectedIds.includes(item.testCaseId))
          .map((item) => ({ testCaseId: item.testCaseId, threadId: item.threadId })),
      );
      close();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Flexbox gap={16} paddingBlock={16} paddingInline={24}>
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <Table
          columns={columns}
          dataSource={cases}
          rowKey="testCaseId"
          scroll={{ y: 400 }}
          size="small"
          style={{ minHeight: 300 }}
          pagination={{
            pageSize,
            showSizeChanger: true,
            size: 'small',
            onShowSizeChange: (_, size) => setPageSize(size),
          }}
        />
      )}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button onClick={close}>{tc('cancel')}</Button>
        <Button
          disabled={selectedIds.length === 0}
          loading={confirming}
          type="primary"
          onClick={handleConfirm}
        >
          {t('run.actions.batchResume.modal.confirm')} ({selectedIds.length})
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default BatchResumeContent;
