'use client';

import { Badge, Checkbox, Table, type TableColumn, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from '@lobehub/ui';
import { type FC, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ArticleSkeleton } from '@/components/Skeleton';
import { agentEvalService } from '@/services/agentEval';

const styles = createStaticStyles(({ css }) => ({
  indexCell: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
}));

type ResumableCase = Awaited<ReturnType<typeof agentEvalService.getResumableCases>>[number];

const StatusLabel = memo<{ status: string | null | undefined }>(({ status }) => {
  const { t } = useTranslation('eval');
  if (status === 'error') return <Badge color="orange" text={t('table.filter.error')} />;
  if (status === 'timeout') return <Badge color="orange" text={t('run.status.timeout')} />;
  return <Tag>{status}</Tag>;
});

export interface BatchResumeContentProps {
  onSelectionChange: (count: number) => void;
  onSelectionReady: (api: { confirm: () => Promise<void>; selectedCount: () => number }) => void;
  runId: string;
  submitter: (targets: Array<{ testCaseId: string; threadId?: string }>) => Promise<void>;
}

const BatchResumeContent: FC<BatchResumeContentProps> = ({
  onSelectionChange,
  onSelectionReady,
  runId,
  submitter,
}) => {
  const { t } = useTranslation('eval');
  const [cases, setCases] = useState<ResumableCase[]>([]);
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    onSelectionChange(selectedIds.length);
  }, [onSelectionChange, selectedIds]);

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

  const confirm = useCallback(async () => {
    if (selectedIds.length === 0) return;
    await submitter(
      cases
        .filter((item) => selectedIds.includes(item.testCaseId))
        .map((item) => ({ testCaseId: item.testCaseId, threadId: item.threadId })),
    );
  }, [cases, selectedIds, submitter]);

  useEffect(() => {
    onSelectionReady({
      confirm,
      selectedCount: () => selectedIds.length,
    });
  }, [confirm, onSelectionReady, selectedIds]);

  const columns: TableColumn<ResumableCase>[] = useMemo(
    () => [
      {
        key: 'select',
        render: (_: any, record: ResumableCase) => (
          <Tooltip title={record.canResume ? undefined : record.reason}>
            <span style={{ display: 'inline-flex' }}>
              <Checkbox
                checked={selectedIds.includes(record.testCaseId)}
                disabled={!record.canResume}
                onChange={(checked) => handleToggleRow(record.testCaseId, checked)}
              />
            </span>
          </Tooltip>
        ),
        title: (
          <Checkbox
            checked={allSelected}
            disabled={resumableCases.length === 0}
            indeterminate={indeterminate}
            onChange={handleToggleAll}
          />
        ),
        width: 48,
      },
      {
        key: 'index',
        render: (_: any, record: ResumableCase) => (
          <span className={styles.indexCell}>{record.sortOrder ?? '-'}</span>
        ),
        title: '#',
        width: 48,
      },
      {
        key: 'input',
        render: (_: any, record: ResumableCase) => (
          <Text as={'p'} ellipsis={{ rows: 2, tooltipWhenOverflow: true }}>
            {record.input}
          </Text>
        ),
        title: t('table.columns.input'),
      },
      {
        key: 'status',
        render: (_: any, record: ResumableCase) => (
          <Tooltip title={record.canResume ? undefined : record.reason}>
            <span style={{ display: 'inline-flex' }}>
              <StatusLabel status={record.resumeStatus} />
            </span>
          </Tooltip>
        ),
        title: t('table.columns.status'),
        width: 110,
      },
    ],
    [t, selectedIds, allSelected, indeterminate, resumableCases, handleToggleRow, handleToggleAll],
  );

  return loading ? (
    <ArticleSkeleton rows={4} />
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
        onShowSizeChange: (_, size) => setPageSize(size),
      }}
    />
  );
};

export default BatchResumeContent;
