'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Check, PenLine } from 'lucide-react';
import { memo } from 'react';

import type { AskUserQuestionItem } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  answer: css`
    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  answerContent: css`
    min-width: 0;
  `,
  answerIcon: css`
    flex-shrink: 0;
    margin-block-start: 3px;
    color: ${cssVar.colorTextSecondary};
  `,
  answerIconSelected: css`
    color: ${cssVar.colorSuccess};
  `,
  answerRow: css`
    box-sizing: border-box;
    width: fit-content;
    max-width: 100%;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 8px;

    background: ${cssVar.colorFillTertiary};
  `,
  container: css`
    padding-block: 8px 4px;
  `,
  description: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
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
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  questionContent: css`
    min-width: 0;
  `,
  titleRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  `,
  unanswered: css`
    width: fit-content;
    max-width: 100%;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

export interface AskUserQuestionResultLabels {
  noAnswer: string;
  notAnswered: string;
}

interface AnswerLineProps {
  description?: string;
  icon: typeof Check;
  selected?: boolean;
  text: string;
}

const AnswerLine = memo<AnswerLineProps>(({ icon, text, description, selected }) => (
  <Flexbox horizontal align="flex-start" className={styles.answerRow} gap={12}>
    <Icon
      className={cx(styles.answerIcon, selected && styles.answerIconSelected)}
      icon={icon}
      size={14}
    />
    <Flexbox className={styles.answerContent} flex={1} gap={4}>
      <span className={styles.answer}>{text}</span>
      {description && <span className={styles.description}>{description}</span>}
    </Flexbox>
  </Flexbox>
));

AnswerLine.displayName = 'AskUserQuestionResultAnswerLine';

interface QuestionAnswerProps {
  answer?: string | string[];
  index?: number;
  notAnswered: string;
  question: AskUserQuestionItem;
}

const QuestionAnswer = memo<QuestionAnswerProps>(({ question, answer, index, notAnswered }) => {
  const labels: string[] = Array.isArray(answer) ? answer : answer ? [answer] : [];
  const optionByLabel = new Map(question.options.map((option) => [option.label, option]));

  return (
    <Flexbox align="flex-start" gap={8} horizontal={!!index}>
      {!!index && <span className={styles.ordinal}>{`Q${index}`}</span>}
      <Flexbox className={styles.questionContent} flex={1} gap={8}>
        <div className={index ? styles.titleRow : undefined}>
          <span className={styles.question}>{question.question}</span>
          {!!index && question.header && <span className={styles.header}>{question.header}</span>}
        </div>
        {labels.length > 0 ? (
          <Flexbox gap={8}>
            {labels.map((label) => {
              const option = optionByLabel.get(label);

              return (
                <AnswerLine
                  selected
                  icon={Check}
                  key={label}
                  text={label}
                  description={
                    option?.description && option.description !== label
                      ? option.description
                      : undefined
                  }
                />
              );
            })}
          </Flexbox>
        ) : (
          <span className={styles.unanswered}>{notAnswered}</span>
        )}
      </Flexbox>
    </Flexbox>
  );
});

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
          <AnswerLine icon={PenLine} text={freeformText} />
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
          />
        ))}
        {isError && <Text type="warning">{labels.noAnswer}</Text>}
      </Flexbox>
    );
  },
);

AskUserQuestionResult.displayName = 'AskUserQuestionResult';

export default AskUserQuestionResult;
