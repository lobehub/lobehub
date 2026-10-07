'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Select, Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { ArrowUpRight, GitCompareArrows, Loader2 } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { createCompareModal } from '@/features/Eval/CompareModal';
import CellAnswer from '@/features/Eval/Comparison/CellAnswer';
import ClampText from '@/features/Eval/Comparison/ClampText';
import { cellVerdict, type ComparisonCell } from '@/features/Eval/Comparison/utils';
import VerdictTag from '@/features/Eval/Comparison/VerdictTag';
import DiagnosisBanner from '@/features/Eval/components/DiagnosisBanner';
import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalSection from '@/features/Eval/components/EvalSection';
import ModelLabel from '@/features/Eval/components/ModelLabel';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  link: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  meta: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  reason: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    padding: 16px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  score: css`
    min-width: 40px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSize};
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: end;
  `,
}));

interface Comparison {
  cells: ComparisonCell[];
  run: {
    config?: { judgeModel?: string; judgeProvider?: string } | null;
    createdAt: string | Date;
    id: string;
    name?: string | null;
    status: string;
  };
}

const ModelRow = memo<{ cell: ComparisonCell }>(({ cell }) => {
  const { t } = useTranslation('eval');
  const verdict = cellVerdict(cell);
  const scoreColor =
    verdict === 'pass' ? cssVar.colorSuccess : verdict === 'fail' ? cssVar.colorError : undefined;

  return (
    <Flexbox className={styles.row} data-testid="case-model-result" gap={12}>
      <Flexbox horizontal align="center" gap={12} justify="space-between">
        <Flexbox horizontal align="center" flex={1} gap={10} style={{ minWidth: 0 }}>
          <VerdictTag verdict={verdict} />
          <ModelLabel model={cell.model} provider={cell.provider} />
        </Flexbox>
        <Flexbox horizontal align="center" gap={12}>
          {typeof cell.durationMs === 'number' && (
            <span className={styles.meta}>{(cell.durationMs / 1000).toFixed(1)}s</span>
          )}
          <span className={styles.score} style={{ color: scoreColor }}>
            {typeof cell.score === 'number' ? cell.score.toFixed(2) : '—'}
          </span>
        </Flexbox>
      </Flexbox>
      {verdict === 'pending' ? (
        <Flexbox horizontal align="center" className={styles.reason} gap={6}>
          <Icon spin icon={Loader2} size={12} />
          {t('caseDetail.results.pending')}
        </Flexbox>
      ) : verdict === 'error' ? (
        <div className={styles.reason}>
          {t(
            cell.error?.stage === 'judge'
              ? 'comparison.cell.error.judge'
              : 'comparison.cell.error.replay',
          )}
          {cell.error?.message ? ` · ${cell.error.message}` : ''}
        </div>
      ) : (
        <>
          <Flexbox gap={4}>
            <span className={styles.label}>{t('comparison.field.judgeReason')}</span>
            {cell.judgeReason ? (
              <ClampText className={styles.reason} lines={2}>
                {cell.judgeReason}
              </ClampText>
            ) : (
              <span className={styles.reason}>{t('comparison.cell.noReason')}</span>
            )}
          </Flexbox>
          <Flexbox gap={4}>
            <span className={styles.label}>{t('comparison.field.actual')}</span>
            <CellAnswer content={cell.content} toolCalls={cell.toolCalls} />
          </Flexbox>
        </>
      )}
    </Flexbox>
  );
});

ModelRow.displayName = 'EvalCaseModelRow';

export interface CaseModelResultsProps {
  /** Only frozen cases can be replayed on other models. */
  canCompare: boolean;
  datasetId: string;
  /** `provider/model` that produced the original answer, preselected in the compare dialog. */
  originalModel?: string;
  testCaseId: string;
}

/**
 * The same frozen call answered by several models: each model's verdict,
 * score, judge reasoning and output, with the diagnosis on top — every model
 * failing points at the harness, some passing points at the model choice.
 */
const CaseModelResults = memo<CaseModelResultsProps>(
  ({ canCompare, datasetId, originalModel, testCaseId }) => {
    const { t } = useTranslation('eval');
    const useFetchTestCaseComparisons = useEvalStore((s) => s.useFetchTestCaseComparisons);
    const { data, error, isLoading, mutate } = useFetchTestCaseComparisons(testCaseId);
    const comparisons = (data ?? []) as Comparison[];
    const [selected, setSelected] = useState<string>();

    // Newest first from the server, so the default is the latest comparison.
    const active = comparisons.find((c) => c.run.id === selected) ?? comparisons[0];
    // Best first: passes by score, then fails, then errors — the ranking is the answer.
    const cells = useMemo(
      () =>
        [...(active?.cells ?? [])].sort(
          (a, b) =>
            Number(b.passed === true) - Number(a.passed === true) ||
            Number(a.status === 'error') - Number(b.status === 'error') ||
            (b.score ?? -1) - (a.score ?? -1),
        ),
      [active],
    );

    const openCompare = () =>
      createCompareModal({
        datasetId,
        initialModels: originalModel ? [originalModel] : undefined,
        onStarted: (runId) => {
          setSelected(runId);
          mutate();
        },
        testCaseIds: [testCaseId],
      });

    const compareButton = canCompare ? (
      <Button
        icon={GitCompareArrows}
        type={comparisons.length ? 'default' : 'primary'}
        onClick={openCompare}
      >
        {comparisons.length
          ? t('caseDetail.results.compareAgain')
          : t('caseDetail.results.compare')}
      </Button>
    ) : undefined;

    return (
      <EvalSection
        actions={comparisons.length ? compareButton : undefined}
        count={active ? cells.length : undefined}
        description={t('caseDetail.results.desc')}
        title={t('caseDetail.results.title')}
      >
        <AsyncBoundary
          data={data}
          error={error}
          isEmpty={!comparisons.length}
          isLoading={isLoading}
          empty={
            canCompare ? (
              <EvalEmpty
                action={compareButton}
                description={t('caseDetail.results.empty.desc')}
                icon={GitCompareArrows}
                title={t('caseDetail.results.empty.title')}
              />
            ) : (
              <EvalEmpty
                compact
                description={t('caseDetail.results.notFrozen.desc')}
                icon={GitCompareArrows}
                title={t('caseDetail.results.notFrozen.title')}
              />
            )
          }
          loading={
            <Flexbox gap={12}>
              <Skeleton height={56} radius={8} width="100%" />
              <Skeleton height={280} radius={8} width="100%" />
            </Flexbox>
          }
          onRetry={() => mutate()}
        >
          {active && (
            <Flexbox gap={12}>
              {comparisons.length > 1 && (
                <Flexbox horizontal align="center" gap={8}>
                  <span className={styles.label} style={{ flex: 'none' }}>
                    {t('caseDetail.results.switcher')}
                  </span>
                  <Select
                    size="small"
                    style={{ minWidth: 280 }}
                    value={active.run.id}
                    options={comparisons.map((c, i) => ({
                      label: `${dayjs(c.run.createdAt).format('MM-DD HH:mm')} · ${c.run.name || c.run.id}${
                        i === 0 ? ` (${t('caseDetail.results.latest')})` : ''
                      }`,
                      value: c.run.id,
                    }))}
                    onChange={(value) => setSelected(value as string)}
                  />
                </Flexbox>
              )}
              <DiagnosisBanner cells={cells} />
              <div className={styles.list}>
                {cells.map((cell) => (
                  <ModelRow cell={cell} key={cell.id} />
                ))}
              </div>
              <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
                <span className={styles.footer}>
                  {t('caseDetail.results.runMeta', {
                    judge: active.run.config?.judgeModel ?? '—',
                    time: dayjs(active.run.createdAt).format('YYYY-MM-DD HH:mm'),
                  })}
                </span>
                <WorkspaceLink to={`/eval/comparisons/${active.run.id}`}>
                  <Flexbox horizontal align="center" className={styles.link} gap={4}>
                    {t('caseDetail.results.openRun')}
                    <Icon icon={ArrowUpRight} size={12} />
                  </Flexbox>
                </WorkspaceLink>
              </Flexbox>
            </Flexbox>
          )}
        </AsyncBoundary>
      </EvalSection>
    );
  },
);

CaseModelResults.displayName = 'EvalCaseModelResults';

export default CaseModelResults;
