'use client';

import type { EvalRubricScore } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { Collapse, Divider, Progress, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    border-inline-start: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
  infoItem: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 4px;
    padding-inline: 0;
  `,
  infoLabel: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
  infoValue: css`
    font-family: monospace;
    font-size: 13px;
    color: ${token.colorText};
  `,
  rubricItem: css`
    padding-block: 8px;
    padding-inline: 0;
  `,
  rubricName: css`
    font-size: 13px;
    font-weight: 500;
  `,
  rubricReason: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${token.colorTextSecondary};
  `,
  rubricScore: css`
    font-family: monospace;
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  sectionTitle: css`
    margin: 0;

    font-size: 12px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
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

const getEvalModeFromRubricId = (rubricId: string): string => {
  return rubricId.replace(/^eval-mode-/, '');
};

const isDeterministicMode = (rubricId: string): boolean => {
  return DETERMINISTIC_MODES.has(getEvalModeFromRubricId(rubricId));
};

const InfoSidebar = memo<InfoSidebarProps>(({ testCase, evalResult, passed, score }) => {
  const { t } = useTranslation('eval');
  const { styles } = useStyles();

  const rubricScores = evalResult?.rubricScores;
  const hasRubricScores = rubricScores && rubricScores.length > 0;

  // Check if all rubrics are deterministic (no score/reason display needed)
  const allDeterministic =
    hasRubricScores && rubricScores.every((s) => isDeterministicMode(s.rubricId));
  // LLM/rubric type scores that have meaningful score + reason
  const scoredRubrics = hasRubricScores
    ? rubricScores.filter((s) => !isDeterministicMode(s.rubricId))
    : [];

  return (
    <Flexbox
      className={styles.container}
      gap={16}
      padding={16}
      style={{ height: '100%', overflowY: 'auto', width: 320 }}
    >
      {/* Test Case */}
      <Flexbox gap={8}>
        <Typography.Text className={styles.sectionTitle}>
          {t('caseDetail.section.testCase')}
        </Typography.Text>

        {testCase?.content?.input && (
          <Flexbox gap={4}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('caseDetail.input')}
            </Text>
            <Text style={{ fontSize: 14 }}>{testCase.content.input}</Text>
          </Flexbox>
        )}

        {testCase?.content?.expected && (
          <Flexbox gap={4}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {t('caseDetail.expected')}
            </Text>
            <Text style={{ fontSize: 14 }}>{testCase.content.expected}</Text>
          </Flexbox>
        )}

        {testCase?.metadata?.difficulty && (
          <Flexbox gap={4}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              {t('caseDetail.difficulty')}
            </Typography.Text>
            <Tag>{t(`difficulty.${testCase.metadata.difficulty}` as any)}</Tag>
          </Flexbox>
        )}

        <Divider style={{ margin: 0 }} />
      </Flexbox>

      {/* Scoring Details */}
      {(hasRubricScores || score !== undefined) && (
        <Flexbox gap={8}>
          <Typography.Text className={styles.sectionTitle}>
            {t('caseDetail.section.scoring')}
          </Typography.Text>

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

          {/* LLM/Rubric modes: show score + progress + expandable reasons */}
          {!allDeterministic && (
            <>
              {score !== undefined && score !== null && (
                <Flexbox gap={4}>
                  <div className={styles.infoItem}>
                    <span className={styles.infoLabel}>{t('caseDetail.score')}</span>
                    <span className={styles.infoValue}>{score.toFixed(2)}</span>
                  </div>
                  <Progress
                    percent={Math.round(score * 100)}
                    size="small"
                    status={passed ? 'success' : 'exception'}
                    strokeLinecap="round"
                  />
                </Flexbox>
              )}

              {scoredRubrics.length > 0 && (
                <Collapse
                  ghost
                  size="small"
                  items={scoredRubrics.map((s) => ({
                    children: s.reason ? (
                      <Typography.Text className={styles.rubricReason}>{s.reason}</Typography.Text>
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

          <Divider style={{ margin: 0 }} />
        </Flexbox>
      )}

      {/* Runtime */}
      <Flexbox gap={8}>
        <Typography.Text className={styles.sectionTitle}>
          {t('caseDetail.section.runtime')}
        </Typography.Text>

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

        {evalResult?.error && (
          <Flexbox gap={4}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              {t('caseDetail.failureReason')}
            </Typography.Text>
            <Typography.Text type="danger">{evalResult.error}</Typography.Text>
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default InfoSidebar;
