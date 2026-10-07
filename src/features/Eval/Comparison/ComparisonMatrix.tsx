'use client';

import { type EvalReplayTarget, type EvalReplayTargetMetrics } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { diagnoseCase } from '@/features/Eval/components/diagnosis';
import { stripSpeakerTags } from '@/features/Eval/components/inputPreview';
import ModelLabel from '@/features/Eval/components/ModelLabel';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import CellAnswer from './CellAnswer';
import DiagnosisTag from './DiagnosisTag';
import { cellVerdict, type ComparisonCase, type ComparisonCell, targetKey } from './utils';
import VerdictTag from './VerdictTag';

const CASE_COL = 280;
const MODEL_COL = 260;

const styles = createStaticStyles(({ css }) => ({
  caseCell: css`
    position: sticky;
    z-index: 1;
    inset-inline-start: 0;

    padding: 12px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  caseText: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    font-size: ${cssVar.fontSize};
    line-height: ${cssVar.lineHeight};
    color: ${cssVar.colorText};
    word-break: break-word;

    &:hover {
      text-decoration: underline;
    }
  `,
  cell: css`
    cursor: pointer;
    min-width: 0;
    padding: 12px;
    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  error: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
  `,
  head: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorFillQuaternary};
  `,
  headCase: css`
    position: sticky;
    z-index: 1;
    inset-inline-start: 0;

    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorBgContainer};
    background-image: linear-gradient(${cssVar.colorFillQuaternary}, ${cssVar.colorFillQuaternary});
  `,
  muted: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    display: contents;

    & > * {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:last-child > * {
      border-block-end: none;
    }
  `,
  scroll: css`
    overflow-x: auto;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  score: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSize};
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  `,
}));

interface ComparisonMatrixProps {
  cases: ComparisonCase[];
  cellIndex: Map<string, Map<string, ComparisonCell>>;
  onOpenCell: (cell: ComparisonCell) => void;
  /** Per-model roll-up, keyed like the columns. */
  summaries: EvalReplayTargetMetrics[];
  targets: EvalReplayTarget[];
}

const caseTitle = (c: ComparisonCase) =>
  typeof c.metadata?.caseId === 'string'
    ? c.metadata.caseId
    : stripSpeakerTags(c.content?.input ?? '') || c.id;

const MatrixCell = memo<{ cell?: ComparisonCell; onOpen: (cell: ComparisonCell) => void }>(
  ({ cell, onOpen }) => {
    const { t } = useTranslation('eval');
    const verdict = cellVerdict(cell);
    const scoreColor =
      verdict === 'pass' ? cssVar.colorSuccess : verdict === 'fail' ? cssVar.colorError : undefined;

    // "Show more" inside the answer expands in place; anywhere else opens the detail drawer.
    const handleClick = (e: MouseEvent) => {
      if (!cell || (e.target as HTMLElement).closest('button')) return;
      onOpen(cell);
    };

    return (
      <Flexbox className={styles.cell} data-testid="comparison-cell" gap={8} onClick={handleClick}>
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <VerdictTag verdict={verdict} />
          {typeof cell?.score === 'number' && (
            <span className={styles.score} style={{ color: scoreColor }}>
              {cell.score.toFixed(2)}
            </span>
          )}
        </Flexbox>
        {verdict === 'error' ? (
          <span className={styles.error}>
            {t(
              cell?.error?.stage === 'judge'
                ? 'comparison.cell.error.judge'
                : 'comparison.cell.error.replay',
            )}
          </span>
        ) : (
          verdict !== 'pending' && (
            <CellAnswer content={cell?.content} lines={4} toolCalls={cell?.toolCalls} />
          )
        )}
      </Flexbox>
    );
  },
);

MatrixCell.displayName = 'EvalComparisonMatrixCell';

/**
 * Cases down, models across: each row ends in its diagnosis, each column
 * heads with the model's pass rate — read a row to place the blame for one
 * case, a column to judge one model.
 */
const ComparisonMatrix = memo<ComparisonMatrixProps>(
  ({ cases, cellIndex, onOpenCell, summaries, targets }) => {
    const { t } = useTranslation('eval');
    const columns = `${CASE_COL}px repeat(${targets.length}, minmax(${MODEL_COL}px, 1fr))`;

    return (
      <div className={styles.scroll}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: columns,
            minWidth: CASE_COL + targets.length * MODEL_COL,
          }}
        >
          <div className={styles.row}>
            <div className={`${styles.head} ${styles.headCase}`}>
              {t('comparison.matrix.case', { count: cases.length })}
            </div>
            {targets.map((target) => {
              const s = summaries.find((m) => targetKey(m) === targetKey(target));
              return (
                <Flexbox className={styles.head} gap={4} key={targetKey(target)}>
                  <ModelLabel model={target.model} provider={target.provider} />
                  {s && (
                    <span className={styles.muted}>
                      {t('comparison.summary.passed', {
                        passed: s.passedCases,
                        total: s.totalCases,
                      })}
                    </span>
                  )}
                </Flexbox>
              );
            })}
          </div>

          {cases.map((testCase) => {
            const row = cellIndex.get(testCase.id);
            const { diagnosis } = diagnoseCase([...(row?.values() ?? [])]);

            return (
              <div className={styles.row} data-testid="comparison-case" key={testCase.id}>
                <Flexbox className={styles.caseCell} gap={8}>
                  <WorkspaceLink to={`/eval/cases/${testCase.id}`}>
                    <span className={styles.caseText}>{caseTitle(testCase)}</span>
                  </WorkspaceLink>
                  <DiagnosisTag diagnosis={diagnosis} />
                </Flexbox>
                {targets.map((target) => (
                  <MatrixCell
                    cell={row?.get(targetKey(target))}
                    key={targetKey(target)}
                    onOpen={onOpenCell}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);

ComparisonMatrix.displayName = 'EvalComparisonMatrix';

export default ComparisonMatrix;
