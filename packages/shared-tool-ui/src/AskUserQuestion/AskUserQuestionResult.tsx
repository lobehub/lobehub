'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import type { AskUserQuestionItem } from './types';

const styles = stylex.create({
  answer: {
    fontSize: '14px',
    lineHeight: 1.5,
    color: cssVar.colorTextTertiary,
    overflowWrap: 'anywhere',
  },
  container: { paddingBlockStart: '8px', paddingBlockEnd: '4px' },
  divider: {
    alignSelf: 'stretch',
    height: '1px',
    marginBlock: '4px',
    background: cssVar.colorFillSecondary,
  },
  header: {
    flexShrink: 0,
    paddingInline: '8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
    background: cssVar.colorFillQuaternary,
  },
  ordinal: {
    flexShrink: 0,
    boxSizing: 'border-box',
    width: '28px',
    height: '20px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '20px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
    background: cssVar.colorFillQuaternary,
  },
  question: {
    fontSize: '14px',
    fontWeight: 400,
    lineHeight: 1.5,
    color: cssVar.colorText,
    overflowWrap: 'anywhere',
  },
  questionContent: { minWidth: '0' },
  recommendedBadge: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '11px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillSecondary,
  },
  titleRow: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'baseline' },
  unanswered: { fontSize: '14px', lineHeight: 1.5, color: cssVar.colorTextQuaternary },
});

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
        {!!index && <span {...stylex.props(styles.ordinal)}>{`Q${index}`}</span>}
        <Flexbox className={stylex.props(styles.questionContent).className} flex={1} gap={4}>
          <div {...stylex.props(index ? styles.titleRow : undefined)}>
            <span {...stylex.props(styles.question)}>{question.question}</span>
            {!!index && question.header && (
              <span {...stylex.props(styles.header)}>{question.header}</span>
            )}
          </div>
          {labels.length > 0 ? (
            labels.map((label) => (
              <Flexbox horizontal align="center" gap={8} key={label}>
                <span {...stylex.props(styles.answer)}>{label}</span>
                {isRecommended(label) && (
                  <span {...stylex.props(styles.recommendedBadge)}>{recommendedTag}</span>
                )}
              </Flexbox>
            ))
          ) : (
            <span {...stylex.props(styles.unanswered)}>{notAnswered}</span>
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
        <Flexbox className={stylex.props(styles.container).className} gap={16}>
          {questions.map((question, index) => (
            <Flexbox
              align="flex-start"
              gap={8}
              horizontal={multiple}
              key={`${question.question}-${index}`}
            >
              {multiple && <span {...stylex.props(styles.ordinal)}>{`Q${index + 1}`}</span>}
              <div
                className={`${stylex.props(styles.questionContent).className} ${multiple ? stylex.props(styles.titleRow).className : ''}`.trim()}
              >
                <span {...stylex.props(styles.question)}>{question.question}</span>
                {multiple && question.header && (
                  <span {...stylex.props(styles.header)}>{question.header}</span>
                )}
              </div>
            </Flexbox>
          ))}
          {multiple && <div {...stylex.props(styles.divider)} />}
          <span {...stylex.props(styles.answer)}>{freeformText}</span>
          {isError && <Text type="warning">{labels.noAnswer}</Text>}
        </Flexbox>
      );
    }

    return (
      <Flexbox className={stylex.props(styles.container).className} gap={16}>
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
            <span {...stylex.props(styles.header)}>{labels.supplement}</span>
            <span {...stylex.props(styles.answer)}>{supplementText}</span>
          </Flexbox>
        )}
        {isError && <Text type="warning">{labels.noAnswer}</Text>}
      </Flexbox>
    );
  },
);

AskUserQuestionResult.displayName = 'AskUserQuestionResult';

export default AskUserQuestionResult;
