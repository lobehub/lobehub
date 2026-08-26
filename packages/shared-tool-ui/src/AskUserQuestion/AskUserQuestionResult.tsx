'use client';

import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { AskUserQuestionItem } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Codex-style flat summary: the question keeps the body text color and the
  // answer drops to tertiary — the exchange reads as a quiet process record,
  // not an interactive control. No chips, icons, or borders. Tertiary (not
  // secondary) so the question/answer hierarchy stays legible at a glance.
  answer: css`
    font-size: 14px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  container: css`
    padding-block: 8px 4px;
  `,
  divider: css`
    align-self: stretch;
    height: 1px;
    margin-block: 4px;
    background: ${cssVar.colorFillSecondary};
  `,
  header: css`
    flex-shrink: 0;

    padding-inline: 8px;
    border-radius: 4px;

    font-size: 12px;
    font-weight: 400;
    line-height: 20px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  ordinal: css`
    flex-shrink: 0;

    box-sizing: border-box;
    width: 28px;
    height: 20px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;

    background: ${cssVar.colorFillQuaternary};
  `,
  question: css`
    font-size: 14px;
    font-weight: 400;
    line-height: 1.5;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  questionContent: css`
    min-width: 0;
  `,
  // Mirrors OptionCard's recommended pill so the marker reads the same in the
  // form and in the completed summary.
  recommendedBadge: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 11px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  titleRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  `,
  unanswered: css`
    font-size: 14px;
    line-height: 1.5;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

export interface AskUserQuestionResultLabels {
  noAnswer: string;
  notAnswered: string;
  /** Badge text for a chosen option carrying the recommended marker. */
  recommendedTag: string;
  supplement: string;
}

interface QuestionAnswerProps {
  answer?: string | string[];
  index?: number;
  notAnswered: string;
  question: AskUserQuestionItem;
  recommendedTag: string;
}

const QuestionAnswer = memo<QuestionAnswerProps>(
  ({ question, answer, index, notAnswered, recommendedTag }) => {
    const labels: string[] = Array.isArray(answer) ? answer : answer ? [answer] : [];
    const isRecommended = (label: string) =>
      question.options.some((o) => o.label === label && o.recommended);

    return (
      <Flexbox align="flex-start" gap={8} horizontal={!!index}>
        {!!index && <span className={styles.ordinal}>{`Q${index}`}</span>}
        <Flexbox className={styles.questionContent} flex={1} gap={4}>
          <div className={index ? styles.titleRow : undefined}>
            <span className={styles.question}>{question.question}</span>
            {!!index && question.header && <span className={styles.header}>{question.header}</span>}
          </div>
          {labels.length > 0 ? (
            labels.map((label) => (
              <Flexbox horizontal align="center" gap={8} key={label}>
                <span className={styles.answer}>{label}</span>
                {isRecommended(label) && (
                  <span className={styles.recommendedBadge}>{recommendedTag}</span>
                )}
              </Flexbox>
            ))
          ) : (
            <span className={styles.unanswered}>{notAnswered}</span>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

QuestionAnswer.displayName = 'AskUserQuestionResultQuestionAnswer';

export interface AskUserQuestionResultProps {
  answers?: Record<string, string | string[]>;
  isError?: boolean;
  labels: AskUserQuestionResultLabels;
  questions: AskUserQuestionItem[];
}

/**
 * Read-only result for a completed AskUserQuestion call.
 *
 * The enclosing tool already supplies the card chrome, so this view stays flat
 * and uses question/answer typography instead of nesting another panel.
 */
export const AskUserQuestionResult = memo<AskUserQuestionResultProps>(
  ({ answers, isError, labels, questions }) => {
    const freeform = answers?.__freeform__;
    const freeformText = typeof freeform === 'string' ? freeform.trim() : '';
    const supplement = answers?.__supplement__;
    const supplementText = typeof supplement === 'string' ? supplement.trim() : '';
    const multiple = questions.length > 1;

    if (freeformText) {
      return (
        <Flexbox className={styles.container} gap={16}>
          {questions.map((question, index) => (
            <Flexbox
              align="flex-start"
              gap={8}
              horizontal={multiple}
              key={`${question.question}-${index}`}
            >
              {multiple && <span className={styles.ordinal}>{`Q${index + 1}`}</span>}
              <div
                className={`${styles.questionContent} ${multiple ? styles.titleRow : ''}`.trim()}
              >
                <span className={styles.question}>{question.question}</span>
                {multiple && question.header && (
                  <span className={styles.header}>{question.header}</span>
                )}
              </div>
            </Flexbox>
          ))}
          {multiple && <div className={styles.divider} />}
          <span className={styles.answer}>{freeformText}</span>
          {isError && <Text type="warning">{labels.noAnswer}</Text>}
        </Flexbox>
      );
    }

    return (
      <Flexbox className={styles.container} gap={16}>
        {questions.map((question, index) => (
          <QuestionAnswer
            answer={answers?.[question.question]}
            index={multiple ? index + 1 : undefined}
            key={`${question.question}-${index}`}
            notAnswered={labels.notAnswered}
            question={question}
            recommendedTag={labels.recommendedTag}
          />
        ))}
        {supplementText && (
          <Flexbox gap={4}>
            <span className={styles.header}>{labels.supplement}</span>
            <span className={styles.answer}>{supplementText}</span>
          </Flexbox>
        )}
        {isError && <Text type="warning">{labels.noAnswer}</Text>}
      </Flexbox>
    );
  },
);

AskUserQuestionResult.displayName = 'AskUserQuestionResult';

export default AskUserQuestionResult;
