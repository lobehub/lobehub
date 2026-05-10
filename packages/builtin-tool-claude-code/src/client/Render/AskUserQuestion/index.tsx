'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo } from 'react';

import type { AskUserQuestionArgs, AskUserQuestionItem } from '../../../types';

/** Persisted draft + answer shape stored on `pluginState`. */
interface AskUserQuestionState {
  askUserAnswers?: Record<string, string | string[]>;
  askUserDraft?: Record<string, string | string[]>;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  answer: css`
    color: ${cssVar.colorText};
  `,
  answerRow: css`
    padding-block: 6px;
    padding-inline: 10px;
    border-radius: 6px;
    background: ${cssVar.colorBgContainer};
  `,
  check: css`
    flex-shrink: 0;
    color: ${cssVar.colorPrimary};
  `,
  container: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  header: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  question: css`
    font-weight: 500;
  `,
}));

interface QABlockProps {
  answer?: string | string[];
  question: AskUserQuestionItem;
}

/**
 * One question/answer pair for the completed Render. The original question
 * stays visible (header + body); the answer renders as one card per picked
 * option (multi-select fans out into multiple rows). When `answer` is
 * absent — older messages persisted before LOBE-8725 added structured
 * storage — we show a `—` placeholder so the layout stays uniform.
 */
const QABlock = memo<QABlockProps>(({ question, answer }) => {
  const labels: string[] = Array.isArray(answer) ? answer : answer ? [answer] : [];
  const optionByLabel = new Map(question.options.map((o) => [o.label, o]));

  return (
    <Flexbox gap={6}>
      {question.header && <span className={styles.header}>{question.header}</span>}
      <Text className={styles.question}>{question.question}</Text>
      {labels.length > 0 ? (
        <Flexbox gap={4}>
          {labels.map((label) => {
            const opt = optionByLabel.get(label);
            return (
              <Flexbox
                horizontal
                align="center"
                className={cx(styles.answerRow)}
                gap={8}
                key={label}
              >
                <Icon className={styles.check} icon={Check} size={14} />
                <Flexbox flex={1} gap={2}>
                  <Text className={styles.answer}>{label}</Text>
                  {opt?.description && opt.description !== label && (
                    <span className={styles.header}>{opt.description}</span>
                  )}
                </Flexbox>
              </Flexbox>
            );
          })}
        </Flexbox>
      ) : (
        <Text type="secondary">—</Text>
      )}
    </Flexbox>
  );
});

QABlock.displayName = 'CCAskUserQuestionQABlock';

/**
 * CC `askUserQuestion` Render — answered / aborted state only.
 *
 * The pending form lives on the canonical Intervention surface
 * (`BuiltinToolInterventions['claude-code']['askUserQuestion']`) — the
 * framework hides this Render while `pluginIntervention.status === 'pending'`,
 * then yields to it once the user submits / skips and a `tool_result` arrives.
 *
 * Structured rendering reads `pluginState.askUserAnswers`, written by
 * `setInterventionAnswers` in `conversationControl` at submit time. If the
 * key is missing (older messages, or skipped/cancelled flows where there's
 * nothing to show), we fall back to the question list with a status hint.
 */
const AskUserQuestion = memo<
  BuiltinRenderProps<AskUserQuestionArgs, AskUserQuestionState, unknown>
>(({ args, pluginError, pluginState }) => {
  const questions = args?.questions ?? [];
  const answers = pluginState?.askUserAnswers;
  const isError = !!pluginError;

  return (
    <Flexbox className={styles.container} gap={12}>
      {questions.map((q, idx) => (
        <QABlock answer={answers?.[q.question]} key={`${q.question}-${idx}`} question={q} />
      ))}
      {isError && (
        <Text type="warning">(No answer received — model continued without their input.)</Text>
      )}
    </Flexbox>
  );
});

AskUserQuestion.displayName = 'CCAskUserQuestion';

export default AskUserQuestion;
