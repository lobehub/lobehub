'use client';

import type { EvalMemorySnapshot, EvalRubricScore } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import {
  Accordion,
  Alert,
  Button,
  createStaticStyles,
  cssVar,
  Flexbox,
  Highlighter,
  Tag,
  Text,
} from '@lobehub/ui';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { levelLabelKey, resolveCaseDifficulty } from '@/features/Eval/caseDifficulty';
import { getJudgeFailure } from '@/features/Eval/judgeError';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import SegmentBar from '../../../../../../../../features/SegmentBar';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgContainer};
  `,
  // Reading block for free-text values (input / expected).
  copyBlock: css`
    font-size: ${cssVar.fontSize};
    line-height: 1.5;
    color: ${cssVar.colorText};
  `,
  infoItem: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 4px;
    padding-inline: 0;
  `,
  infoLabel: css`
    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextSecondary};
  `,
  infoValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorText};
  `,
  // The headline score for the panel — large mono number on a tonal surface.
  scoreCard: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  scoreValue: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading3};
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  // Divider between titled sections — tonal hairline, not a heavy rule.
  section: css`
    padding-block-end: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  rubricName: css`
    font-size: ${cssVar.fontSize};
    font-weight: 500;
  `,
  rubricReason: css`
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  rubricScore: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
}));

/**
 * Common eval result data used for display.
 * Both EvalRunTopicResult and EvalThreadResult satisfy this interface.
 */
export interface EvalResultDisplayData {
  completionReason?: string;
  cost?: number;
  duration?: number;
  error?: string;
  errorPhase?: string;
  externalResult?: Record<string, unknown>;
  judgeError?: string;
  /** The attempt's Memory at the end: what the case seeded and what the model wrote. */
  memorySnapshot?: EvalMemorySnapshot;
  rubricScores?: EvalRubricScore[];
  steps?: number;
  tokens?: number;
}

interface InfoSidebarProps {
  evalResult?: EvalResultDisplayData | null;
  experimentId?: string;
  passed?: boolean | null;
  score?: number | null;
  status?: string | null;
  testCase?: any;
}

// Deterministic eval modes that only produce pass/fail (no score or reason)
const DETERMINISTIC_MODES = new Set([
  'equals',
  'contains',
  'regex',
  'starts-with',
  'ends-with',
  'any-of',
  'numeric',
  'extract-match',
  'json-schema',
  'javascript',
  'python',
]);

// Section label — one consistent treatment for every field heading in the panel.
const SectionTitle = memo<{ children: ReactNode }>(({ children }) => (
  <Text fontSize={12} type={'secondary'} weight={500}>
    {children}
  </Text>
));

const getEvalModeFromRubricId = (rubricId: string): string => {
  return rubricId.replace(/^eval-mode-/, '');
};

const isDeterministicMode = (rubricId: string): boolean => {
  return DETERMINISTIC_MODES.has(getEvalModeFromRubricId(rubricId));
};

const InfoSidebar = memo<InfoSidebarProps>((props) => {
  const { testCase, evalResult, passed, score, status, experimentId } = props;
  const { t } = useTranslation('eval');
  const judgeFailure = getJudgeFailure(status, evalResult);
  const difficulty = resolveCaseDifficulty(testCase?.metadata);
  const rubricScores = evalResult?.rubricScores;
  const hasRubricScores = !judgeFailure && rubricScores && rubricScores.length > 0;

  // Check if all rubrics are deterministic (no score/reason display needed)
  const allDeterministic =
    hasRubricScores && rubricScores.every((s) => isDeterministicMode(s.rubricId));
  // LLM/rubric type scores that have meaningful score + reason
  const scoredRubrics = hasRubricScores
    ? rubricScores.filter((s) => !isDeterministicMode(s.rubricId))
    : [];

  const hasScore = !judgeFailure && score !== undefined && score !== null;
  const scorePct = hasScore ? Math.max(0, Math.min(100, Math.round(score * 100))) : 0;
  // A rule-checklist judge reports one verdict per rule beside its prose reason.
  const ruleVerdicts = judgeFailure
    ? []
    : (rubricScores?.find((s) => s.verdicts?.length)?.verdicts ?? []);
  const memoryEntries = evalResult?.memorySnapshot?.entries;
  const formatDay = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  };

  return (
    <Flexbox
      className={styles.container}
      gap={16}
      padding={16}
      style={{ height: '100%', overflowY: 'auto', width: 320 }}
    >
      {judgeFailure && (
        <Flexbox className={styles.section} gap={8}>
          <Alert title={t('lobeBench.compare.judgeError')} type={'warning'} />
          {judgeFailure.diagnostic && (
            <Text className={styles.copyBlock} type={'warning'}>
              {judgeFailure.diagnostic}
            </Text>
          )}
          {experimentId && (
            <>
              <Text fontSize={12} type={'secondary'}>
                {t('caseDetail.judgeError.regradeHint')}
              </Text>
              <WorkspaceLink to={`/eval/lobe-bench/experiments/${experimentId}`}>
                <Button size={'small'}>{t('lobeBench.attempt.backToExperiment')}</Button>
              </WorkspaceLink>
            </>
          )}
        </Flexbox>
      )}
      {/* Failure reason — error states surface at the top of the panel */}
      {!judgeFailure && evalResult?.error && (
        <Flexbox className={styles.section} gap={8}>
          <SectionTitle>{t('caseDetail.failureReason')}</SectionTitle>
          <Text className={styles.copyBlock} type="danger">
            {evalResult.error}
          </Text>
        </Flexbox>
      )}

      {/* Test Case */}
      <Flexbox className={styles.section} gap={12}>
        <SectionTitle>{t('caseDetail.section.testCase')}</SectionTitle>

        {testCase?.content?.input && (
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('caseDetail.input')}
            </Text>
            <Text className={styles.copyBlock}>{testCase.content.input}</Text>
          </Flexbox>
        )}

        {testCase?.content?.expected && (
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('caseDetail.expected')}
            </Text>
            <Text className={styles.copyBlock}>{testCase.content.expected}</Text>
          </Flexbox>
        )}

        {difficulty && (
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('caseDetail.difficulty')}
            </Text>
            <Flexbox horizontal>
              <Tag>
                {t(
                  difficulty.kind === 'level'
                    ? levelLabelKey(difficulty.level)
                    : `difficulty.${difficulty.value}`,
                )}
              </Tag>
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>

      {/* Scoring Details */}
      {!judgeFailure && (hasRubricScores || score !== undefined) && (
        <Flexbox className={styles.section} gap={12}>
          <SectionTitle>{t('caseDetail.section.scoring')}</SectionTitle>

          {/* Deterministic modes: just show eval mode + pass/fail */}
          {allDeterministic && hasRubricScores && (
            <div className={styles.infoItem}>
              <span className={styles.infoValue}>
                {t(`evalMode.${getEvalModeFromRubricId(rubricScores[0].rubricId)}` as any)}
              </span>
              <Tag color={passed ? 'success' : 'error'}>
                {passed ? t('table.filter.passed') : t('table.filter.failed')}
              </Tag>
            </div>
          )}

          {/* LLM/Rubric modes: show score card + pill progress + expandable reasons */}
          {!allDeterministic && (
            <>
              {hasScore && (
                <Flexbox className={styles.scoreCard} gap={8}>
                  <Flexbox horizontal align="flex-end" gap={8} justify="space-between">
                    <span className={styles.scoreValue}>{score.toFixed(2)}</span>
                    <Text fontSize={12} type="secondary">
                      {t('caseDetail.score')}
                    </Text>
                  </Flexbox>
                  <SegmentBar
                    segments={[
                      {
                        color: passed ? cssVar.colorSuccess : cssVar.colorError,
                        value: scorePct,
                      },
                      { color: cssVar.colorFillSecondary, value: 100 - scorePct },
                    ]}
                  />
                </Flexbox>
              )}

              {scoredRubrics.length > 0 && (
                <Accordion
                  defaultValue={[]}
                  styles={{ trigger: { paddingInline: 12 } }}
                  items={scoredRubrics.map((s) => ({
                    children: s.reason ? (
                      <span className={styles.rubricReason}>{s.reason}</span>
                    ) : null,
                    key: s.rubricId,
                    title: (
                      <Flexbox horizontal align="center" gap={8} justify="space-between">
                        <span className={styles.rubricName}>
                          {t(`evalMode.${getEvalModeFromRubricId(s.rubricId)}` as any)}
                        </span>
                        <span className={styles.rubricScore}>{(s.score * 100).toFixed(0)}%</span>
                      </Flexbox>
                    ),
                  }))}
                />
              )}
            </>
          )}
        </Flexbox>
      )}

      {/* Rules: one line per rule, the reason only where the judge found it unmet */}
      {ruleVerdicts.length > 0 && (
        <Flexbox className={styles.section} gap={8}>
          <SectionTitle>{t('caseDetail.section.rules')}</SectionTitle>
          <Flexbox gap={6}>
            {ruleVerdicts.map((item, index) => (
              <Flexbox gap={2} key={index}>
                <Text
                  fontSize={12}
                  type={
                    item.verdict === 'satisfied'
                      ? 'secondary'
                      : item.verdict === 'violated'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {item.verdict === 'satisfied' ? '✓' : item.verdict === 'violated' ? '✗' : '?'}{' '}
                  {item.rule}
                </Text>
                {item.verdict !== 'satisfied' && item.reason && (
                  <span className={styles.rubricReason}>{item.reason}</span>
                )}
              </Flexbox>
            ))}
          </Flexbox>
        </Flexbox>
      )}

      {/* Runtime */}
      <Flexbox gap={8}>
        <SectionTitle>{t('caseDetail.section.runtime')}</SectionTitle>

        {evalResult?.duration !== undefined && evalResult.duration !== null && (
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>{t('caseDetail.duration')}</span>
            <span className={styles.infoValue}>{(evalResult.duration / 1000).toFixed(1)}s</span>
          </div>
        )}

        {evalResult?.steps !== undefined && evalResult.steps !== null && (
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>{t('caseDetail.steps')}</span>
            <span className={styles.infoValue}>{evalResult.steps}</span>
          </div>
        )}

        {evalResult?.cost !== undefined && evalResult.cost !== null && (
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>{t('caseDetail.cost')}</span>
            <span className={styles.infoValue}>${formatCost(evalResult.cost)}</span>
          </div>
        )}

        {evalResult?.tokens !== undefined && evalResult.tokens !== null && (
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>{t('caseDetail.tokens')}</span>
            <span className={styles.infoValue}>{formatShortenNumber(evalResult.tokens)}</span>
          </div>
        )}

        {evalResult?.completionReason && (
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>{t('caseDetail.completionReason')}</span>
            <Tag>{evalResult.completionReason}</Tag>
          </div>
        )}
      </Flexbox>

      {/* Memory the attempt ended with: seeded rows and rows the model wrote */}
      {memoryEntries && (
        <Flexbox gap={8}>
          <SectionTitle>{t('caseDetail.section.memory')}</SectionTitle>
          {memoryEntries.length === 0 ? (
            <Text fontSize={12} type="secondary">
              {t('caseDetail.memory.empty')}
            </Text>
          ) : (
            <Flexbox gap={8}>
              {memoryEntries.map((entry) => (
                <Flexbox gap={2} key={entry.id}>
                  <Flexbox horizontal align="center" gap={6} wrap="wrap">
                    <Tag>{entry.layer}</Tag>
                    <Tag color={entry.source === 'agent' ? 'processing' : undefined}>
                      {entry.source === 'agent'
                        ? t('caseDetail.memory.agent')
                        : t('caseDetail.memory.seed')}
                    </Tag>
                    {entry.removedReason && (
                      <Tag color="warning">{t('caseDetail.memory.removed')}</Tag>
                    )}
                    <span className={styles.rubricScore}>{formatDay(entry.capturedAt)}</span>
                  </Flexbox>
                  <Text
                    fontSize={12}
                    style={entry.removedReason ? { textDecoration: 'line-through' } : undefined}
                  >
                    {entry.title || entry.summary || entry.details || entry.layer}
                  </Text>
                  {entry.title && entry.summary && entry.summary !== entry.title && (
                    <span className={styles.rubricReason}>{entry.summary}</span>
                  )}
                </Flexbox>
              ))}
            </Flexbox>
          )}
        </Flexbox>
      )}

      {evalResult?.externalResult && (
        <Flexbox gap={8}>
          <SectionTitle>{t('caseDetail.section.externalResult')}</SectionTitle>
          <Highlighter
            wrap
            actionIconSize="small"
            language="json"
            style={{ fontSize: 12, maxHeight: 360, overflow: 'auto' }}
            variant="filled"
          >
            {JSON.stringify(evalResult.externalResult, null, 2)}
          </Highlighter>
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default InfoSidebar;
