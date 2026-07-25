'use client';

import type { EvalRubricScore } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Flexbox, Highlighter, Tag, Text } from '@lobehub/ui';
import { Collapse } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
  externalResult?: Record<string, unknown>;
  rubricScores?: EvalRubricScore[];
  steps?: number;
  tokens?: number;
}

interface InfoSidebarProps {
  evalResult?: EvalResultDisplayData | null;
  passed?: boolean | null;
  score?: number | null;
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

const InfoSidebar = memo<InfoSidebarProps>(({ testCase, evalResult, passed, score }) => {
  const { t } = useTranslation('eval');
  const rubricScores = evalResult?.rubricScores;
  const hasRubricScores = rubricScores && rubricScores.length > 0;

  // Check if all rubrics are deterministic (no score/reason display needed)
  const allDeterministic =
    hasRubricScores && rubricScores.every((s) => isDeterministicMode(s.rubricId));
  // LLM/rubric type scores that have meaningful score + reason
  const scoredRubrics = hasRubricScores
    ? rubricScores.filter((s) => !isDeterministicMode(s.rubricId))
    : [];

  const hasScore = score !== undefined && score !== null;
  const scorePct = hasScore ? Math.max(0, Math.min(100, Math.round(score * 100))) : 0;

  return (
    <Flexbox
      className={styles.container}
      gap={16}
      padding={16}
      style={{ height: '100%', overflowY: 'auto', width: 320 }}
    >
      {/* Failure reason — error states surface at the top of the panel */}
      {evalResult?.error && (
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

        {testCase?.metadata?.difficulty && (
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('caseDetail.difficulty')}
            </Text>
            <Flexbox horizontal>
              <Tag>{t(`difficulty.${testCase.metadata.difficulty}` as any)}</Tag>
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>

      {/* Scoring Details */}
      {(hasRubricScores || score !== undefined) && (
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
                      { color: passed ? cssVar.colorSuccess : cssVar.colorError, value: scorePct },
                      { color: cssVar.colorFillSecondary, value: 100 - scorePct },
                    ]}
                  />
                </Flexbox>
              )}

              {scoredRubrics.length > 0 && (
                <Collapse
                  ghost
                  size="small"
                  items={scoredRubrics.map((s) => ({
                    children: s.reason ? (
                      <span className={styles.rubricReason}>{s.reason}</span>
                    ) : null,
                    key: s.rubricId,
                    label: (
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
