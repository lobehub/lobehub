'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, Database, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { agentEvalService } from '@/services/agentEval';
import { runSelectors, useEvalStore } from '@/store/eval';

import { createDatasetEditModal } from '../../../../features/DatasetEditModal';
import { createDatasetImportModal } from '../../../../features/DatasetImportModal';
import SegmentBar from '../../../../features/SegmentBar';
import { createTestCaseCreateModal } from '../../../../features/TestCaseCreateModal';
import { createTestCaseEditModal } from '../../../../features/TestCaseEditModal';
import TestCasePreviewPanel from '../../features/DatasetsTab/TestCasePreviewPanel';
import TestCaseTable from '../../features/DatasetsTab/TestCaseTable';
import { createRunCreateModal } from '../../features/RunCreateModal';
import EmptyState from '../../features/RunsTab/EmptyState';
import RunCard from '../../features/RunsTab/RunCard';

const styles = createStaticStyles(({ css }) => ({
  backLink: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    width: fit-content;

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextTertiary};
    text-decoration: none;

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  header: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorPrimaryBg};
  `,
  // Summary hero — leads the dataset detail with its headline case count as a
  // large mono figure, mirroring the benchmark/run result heroes.
  heroBand: css`
    padding: 20px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  heroValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading2};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  summaryDot: css`
    width: 8px;
    height: 8px;
    border-radius: 999px;
  `,
  tableWrapper: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
}));

const DatasetDetail = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarkId, datasetId } = useParams<{ benchmarkId: string; datasetId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { message } = App.useApp();

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [search, setSearch] = useState('');
  const [diffFilter, setDiffFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const [previewCase, setPreviewCase] = useState<any | null>(null);

  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);
  const useFetchDatasetRuns = useEvalStore((s) => s.useFetchDatasetRuns);
  const runList = useEvalStore(runSelectors.datasetRunList(datasetId!));
  const refreshTestCases = useEvalStore((s) => s.refreshTestCases);
  const refreshDatasetDetail = useEvalStore((s) => s.refreshDatasetDetail);

  const { data: dataset } = useFetchDatasetDetail(datasetId);
  useFetchDatasetRuns(datasetId);

  const sortedRuns = useMemo(
    () =>
      [...runList].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [runList],
  );

  const { data: testCaseData } = useFetchTestCases({
    datasetId: datasetId!,
    limit: pagination.pageSize,
    offset: (pagination.current - 1) * pagination.pageSize,
  });

  const testCases = testCaseData?.data || [];
  const total = testCaseData?.total || 0;

  const filteredCases = testCases.filter((c: any) => {
    if (diffFilter !== 'all' && c.metadata?.difficulty !== diffFilter) return false;
    if (search && !c.content?.input?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Difficulty mix across the loaded cases — feeds the summary hero's bar.
  const difficulty = useMemo(() => {
    const counts = { easy: 0, hard: 0, medium: 0 };
    for (const c of testCases as any[]) {
      const d = c?.metadata?.difficulty as 'easy' | 'hard' | 'medium' | undefined;
      if (d === 'easy' || d === 'medium' || d === 'hard') counts[d] += 1;
    }
    return {
      counts,
      segments: [
        { color: cssVar.colorSuccess, value: counts.easy },
        { color: cssVar.colorWarning, value: counts.medium },
        { color: cssVar.colorError, value: counts.hard },
      ],
      tagged: counts.easy + counts.medium + counts.hard,
    };
  }, [testCases]);

  const handleRefresh = useCallback(async () => {
    if (datasetId) {
      await refreshTestCases(datasetId);
      await refreshDatasetDetail(datasetId);
    }
  }, [datasetId, refreshTestCases, refreshDatasetDetail]);

  const handleDeleteCase = useCallback(
    (testCase: any) => {
      confirmModal({
        content: t('testCase.delete.confirm'),
        okButtonProps: { danger: true },
        okText: t('common.delete'),
        onOk: async () => {
          try {
            await agentEvalService.deleteTestCase(testCase.id);
            message.success(t('testCase.delete.success'));
            await handleRefresh();
          } catch {
            message.error(t('testCase.delete.error'));
          }
        },
        title: t('common.delete'),
      });
    },
    [handleRefresh, message, t],
  );

  const handleDelete = useCallback(() => {
    confirmModal({
      content: t('dataset.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('common.delete'),
      onOk: async () => {
        try {
          await agentEvalService.deleteDataset(datasetId!);
          message.success(t('dataset.delete.success'));
          navigate(`/eval/bench/${benchmarkId}`);
        } catch {
          message.error(t('dataset.delete.error'));
        }
      },
      title: t('common.delete'),
    });
  }, [benchmarkId, datasetId, message, navigate, t]);

  if (!dataset) return null;

  return (
    <>
      <Flexbox horizontal style={{ flex: 1, minHeight: 0 }}>
        <Flexbox
          flex={1}
          gap={24}
          style={{ minWidth: 0, overflow: 'auto', paddingBlock: 24, paddingInline: 32 }}
        >
          {/* Back link */}
          <WorkspaceLink className={styles.backLink} to={`/eval/bench/${benchmarkId}`}>
            <ArrowLeft size={16} />
            {t('dataset.detail.backToBenchmark')}
          </WorkspaceLink>

          {/* Header */}
          <Flexbox horizontal align="start" justify="space-between">
            <Flexbox horizontal align="start" gap={12}>
              <div className={styles.header}>
                <Database size={20} style={{ color: cssVar.colorPrimary }} />
              </div>
              <Flexbox gap={4}>
                <Text as="h4" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                  {dataset.name}
                </Text>
                {dataset.description && <Text type="secondary">{dataset.description}</Text>}
              </Flexbox>
            </Flexbox>

            <Flexbox horizontal gap={8}>
              <Button
                icon={Pencil}
                size="small"
                variant="outlined"
                onClick={() => createDatasetEditModal({ dataset, onSuccess: handleRefresh })}
              >
                {t('common.edit')}
              </Button>
              <Button danger icon={Trash2} size="small" variant="outlined" onClick={handleDelete}>
                {t('common.delete')}
              </Button>
            </Flexbox>
          </Flexbox>

          {/* Summary hero — headline case count + difficulty mix */}
          <Flexbox
            horizontal
            align="center"
            className={styles.heroBand}
            gap={16}
            justify="space-between"
          >
            <Flexbox gap={6}>
              <span className={styles.heroValue}>{total}</span>
              <Text color={cssVar.colorTextTertiary} fontSize={12}>
                {t('dataset.detail.testCases')}
              </Text>
            </Flexbox>
            {difficulty.tagged > 0 && (
              <Flexbox gap={8} style={{ maxWidth: 280, minWidth: 0, width: '100%' }}>
                <SegmentBar segments={difficulty.segments} />
                <Flexbox horizontal gap={12} justify="flex-end" style={{ flexWrap: 'wrap' }}>
                  {(['easy', 'medium', 'hard'] as const).map((d) => (
                    <Flexbox horizontal align="center" gap={6} key={d}>
                      <span
                        className={styles.summaryDot}
                        style={{
                          background:
                            d === 'easy'
                              ? cssVar.colorSuccess
                              : d === 'medium'
                                ? cssVar.colorWarning
                                : cssVar.colorError,
                        }}
                      />
                      <Text color={cssVar.colorTextTertiary} fontSize={12}>
                        {t(`difficulty.${d}`)} {difficulty.counts[d]}
                      </Text>
                    </Flexbox>
                  ))}
                </Flexbox>
              </Flexbox>
            )}
          </Flexbox>

          {/* Test Cases */}
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" justify="space-between">
              <Text weight={600}>{t('dataset.detail.testCases')}</Text>
              <Text type="secondary">{t('dataset.detail.caseCount', { count: total })}</Text>
            </Flexbox>

            <div className={styles.tableWrapper}>
              <TestCaseTable
                datasetEvalMode={dataset?.evalMode}
                diffFilter={diffFilter}
                pagination={pagination}
                search={search}
                selectedId={previewCase?.id}
                testCases={filteredCases}
                total={total}
                onDelete={handleDeleteCase}
                onPageChange={(page, pageSize) => setPagination({ current: page, pageSize })}
                onPreview={setPreviewCase}
                onAddCase={() =>
                  createTestCaseCreateModal({ datasetId: datasetId!, onSuccess: handleRefresh })
                }
                onDiffFilterChange={(f) => {
                  setDiffFilter(f);
                  setPagination((prev) => ({ ...prev, current: 1 }));
                }}
                onEdit={(testCase) =>
                  createTestCaseEditModal({ onSuccess: handleRefresh, testCase })
                }
                onImport={() =>
                  createDatasetImportModal({ datasetId: datasetId!, onSuccess: handleRefresh })
                }
                onSearchChange={(v) => {
                  setSearch(v);
                  setPagination((prev) => ({ ...prev, current: 1 }));
                }}
              />
            </div>
          </Flexbox>

          {/* Related Runs */}
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" justify="space-between">
              <Text weight={600}>
                {t('dataset.detail.relatedRuns', { count: sortedRuns.length })}
              </Text>
              <Button
                icon={Plus}
                size="small"
                onClick={() =>
                  createRunCreateModal({
                    benchmarkId: benchmarkId!,
                    datasetId: datasetId!,
                    datasetName: dataset.name,
                  })
                }
              >
                {t('dataset.detail.addRun')}
              </Button>
            </Flexbox>
            {sortedRuns.length > 0 ? (
              <Flexbox gap={12}>
                {sortedRuns.map((run) => (
                  <RunCard benchmarkId={benchmarkId!} key={run.id} run={run} />
                ))}
              </Flexbox>
            ) : (
              <EmptyState
                onCreate={() =>
                  createRunCreateModal({
                    benchmarkId: benchmarkId!,
                    datasetId: datasetId!,
                    datasetName: dataset.name,
                  })
                }
              />
            )}
          </Flexbox>
        </Flexbox>

        {previewCase && (
          <TestCasePreviewPanel testCase={previewCase} onClose={() => setPreviewCase(null)} />
        )}
      </Flexbox>
    </>
  );
});

export default DatasetDetail;
