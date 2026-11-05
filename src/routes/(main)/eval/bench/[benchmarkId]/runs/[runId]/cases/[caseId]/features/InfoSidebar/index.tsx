'use client';

import type { EvalRubricScore } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { Accordion, Flexbox, Highlighter, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import SegmentBar from '../../../../../../../../features/SegmentBar';

const styles = stylex.create({
  container: {
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  copyBlock: { fontSize: cssVar.fontSize, lineHeight: 1.5, color: cssVar.colorText },
  infoItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '4px',
    paddingInline: '0',
  },
  infoLabel: { fontSize: cssVar.fontSize, color: cssVar.colorTextSecondary },
  infoValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSize,
    color: cssVar.colorText,
  },
  scoreCard: {
    padding: '12px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  scoreValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeHeading3,
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorText,
  },
  section: {
    paddingBlockEnd: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  rubricName: { fontSize: cssVar.fontSize, fontWeight: 500 },
  rubricReason: { fontSize: cssVar.fontSizeSM, lineHeight: 1.5, color: cssVar.colorTextSecondary },
  rubricScore: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextSecondary,
  },
});

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
      className={stylex.props(styles.container).className}
      gap={16}
      padding={16}
      style={{ height: '100%', overflowY: 'auto', width: 320 }}
    >
      {/* Failure reason — error states surface at the top of the panel */}
      {evalResult?.error && (
        <Flexbox className={stylex.props(styles.section).className} gap={8}>
          <SectionTitle>{t('caseDetail.failureReason')}</SectionTitle>
          <Text className={stylex.props(styles.copyBlock).className} type="danger">
            {evalResult.error}
          </Text>
        </Flexbox>
      )}

      {/* Test Case */}
      <Flexbox className={stylex.props(styles.section).className} gap={12}>
        <SectionTitle>{t('caseDetail.section.testCase')}</SectionTitle>

        {testCase?.content?.input && (
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('caseDetail.input')}
            </Text>
            <Text className={stylex.props(styles.copyBlock).className}>
              {testCase.content.input}
            </Text>
          </Flexbox>
        )}

        {testCase?.content?.expected && (
          <Flexbox gap={4}>
            <Text fontSize={12} type="secondary">
              {t('caseDetail.expected')}
            </Text>
            <Text className={stylex.props(styles.copyBlock).className}>
              {testCase.content.expected}
            </Text>
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
        <Flexbox className={stylex.props(styles.section).className} gap={12}>
          <SectionTitle>{t('caseDetail.section.scoring')}</SectionTitle>

          {/* Deterministic modes: just show eval mode + pass/fail */}
          {allDeterministic && hasRubricScores && (
            <div {...stylex.props(styles.infoItem)}>
              <span {...stylex.props(styles.infoValue)}>
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
                <Flexbox className={stylex.props(styles.scoreCard).className} gap={8}>
                  <Flexbox horizontal align="flex-end" gap={8} justify="space-between">
                    <span {...stylex.props(styles.scoreValue)}>{score.toFixed(2)}</span>
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
                <Accordion
                  defaultValue={[]}
                  styles={{ trigger: { paddingInline: 12 } }}
                  items={scoredRubrics.map((s) => ({
                    children: s.reason ? (
                      <span {...stylex.props(styles.rubricReason)}>{s.reason}</span>
                    ) : null,
                    key: s.rubricId,
                    title: (
                      <Flexbox horizontal align="center" gap={8} justify="space-between">
                        <span {...stylex.props(styles.rubricName)}>
                          {t(`evalMode.${getEvalModeFromRubricId(s.rubricId)}` as any)}
                        </span>
                        <span {...stylex.props(styles.rubricScore)}>
                          {(s.score * 100).toFixed(0)}%
                        </span>
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
          <div {...stylex.props(styles.infoItem)}>
            <span {...stylex.props(styles.infoLabel)}>{t('caseDetail.duration')}</span>
            <span {...stylex.props(styles.infoValue)}>
              {(evalResult.duration / 1000).toFixed(1)}s
            </span>
          </div>
        )}

        {evalResult?.steps !== undefined && evalResult.steps !== null && (
          <div {...stylex.props(styles.infoItem)}>
            <span {...stylex.props(styles.infoLabel)}>{t('caseDetail.steps')}</span>
            <span {...stylex.props(styles.infoValue)}>{evalResult.steps}</span>
          </div>
        )}

        {evalResult?.cost !== undefined && evalResult.cost !== null && (
          <div {...stylex.props(styles.infoItem)}>
            <span {...stylex.props(styles.infoLabel)}>{t('caseDetail.cost')}</span>
            <span {...stylex.props(styles.infoValue)}>${formatCost(evalResult.cost)}</span>
          </div>
        )}

        {evalResult?.tokens !== undefined && evalResult.tokens !== null && (
          <div {...stylex.props(styles.infoItem)}>
            <span {...stylex.props(styles.infoLabel)}>{t('caseDetail.tokens')}</span>
            <span {...stylex.props(styles.infoValue)}>
              {formatShortenNumber(evalResult.tokens)}
            </span>
          </div>
        )}

        {evalResult?.completionReason && (
          <div {...stylex.props(styles.infoItem)}>
            <span {...stylex.props(styles.infoLabel)}>{t('caseDetail.completionReason')}</span>
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
