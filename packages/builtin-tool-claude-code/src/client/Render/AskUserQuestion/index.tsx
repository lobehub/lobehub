'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Check, PenLine } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AskUserQuestionArgs, AskUserQuestionItem } from '../../../types';

/** Persisted draft + answer shape stored on `pluginState`. */
interface AskUserQuestionState {
  askUserAnswers?: Record<string, string | string[]>;
  askUserDraft?: Record<string, string | string[]>;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  answer: css`
    line-height: 1.6;
    color: ${cssVar.colorText};
  `,
  check: css`
    flex-shrink: 0;
    margin-block-start: 3px;
    color: ${cssVar.colorPrimary};
  `,
  container: css`
    padding-block: 4px;
  `,
  description: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
  divider: css`
    align-self: stretch;
    height: 1px;
    background: ${cssVar.colorFillSecondary};
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  question: css`
    font-size: 15px;
    font-weight: 500;
    line-height: 1.5;
    color: ${cssVar.colorText};
  `,
}));

interface QABlockProps {
  answer?: string | string[];
  question: AskUserQuestionItem;
}

/**
 * One question/answer pair for the completed Render, laid out as a single
 * flat surface (no nested cards): a "Question" label + the question text,
 * a hairline divider, then a "Selected" label + the picked option(s). Each
 * pick is one check-prefixed line with its description underneath; multi-select
 * fans out into multiple lines. When `answer` is absent — older messages
 * persisted before structured storage — we show a `—` placeholder so the
 * layout stays uniform.
 */
const QABlock = memo<QABlockProps>(({ question, answer }) => {
  const { t } = useTranslation('plugin');
  const labels: string[] = Array.isArray(answer) ? answer : answer ? [answer] : [];
  const optionByLabel = new Map(question.options.map((o) => [o.label, o]));

  return (
    <Flexbox gap={12}>
      <Flexbox gap={6}>
        <span className={styles.label}>
          {t('builtins.lobe-claude-code.askUserQuestion.question')}
        </span>
        <div className={styles.question}>{question.question}</div>
      </Flexbox>

      <div className={styles.divider} />

      <Flexbox gap={8}>
        <span className={styles.label}>
          {t('builtins.lobe-claude-code.askUserQuestion.selected')}
        </span>
        {labels.length > 0 ? (
          <Flexbox gap={10}>
            {labels.map((label) => {
              const opt = optionByLabel.get(label);
              return (
                <Flexbox gap={2} key={label}>
                  <Flexbox horizontal align="flex-start" gap={8}>
                    <Icon className={styles.check} icon={Check} size={14} />
                    <Text className={styles.answer}>{label}</Text>
                  </Flexbox>
                  {opt?.description && opt.description !== label && (
                    <span className={styles.description} style={{ paddingInlineStart: 22 }}>
                      {opt.description}
                    </span>
                  )}
                </Flexbox>
              );
            })}
          </Flexbox>
        ) : (
          <Text type="secondary">—</Text>
        )}
      </Flexbox>
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
 *
 * Single-layer surface: the framework's tool card already provides the
 * containing card, so this Render stays flat (no own background) to avoid the
 * card-in-card look.
 */
const AskUserQuestion = memo<
  BuiltinRenderProps<AskUserQuestionArgs, AskUserQuestionState, unknown>
>(({ args, pluginError, pluginState }) => {
  const { t } = useTranslation('plugin');
  const questions = args?.questions ?? [];
  const answers = pluginState?.askUserAnswers;
  const freeform = answers?.['__freeform__'];
  const freeformText = typeof freeform === 'string' ? freeform.trim() : '';
  const isError = !!pluginError;

  // Escape-mode reply: the user opted out of the multi-choice form and
  // wrote freeform text instead. The form picks are intentionally absent,
  // so render the questions for context (label + body) plus the typed reply
  // as a check-style line — Q&A pairs would render as empty rows.
  if (freeformText) {
    return (
      <Flexbox className={styles.container} gap={16}>
        {questions.map((q, idx) => (
          <Flexbox gap={6} key={`${q.question}-${idx}`}>
            <span className={styles.label}>
              {t('builtins.lobe-claude-code.askUserQuestion.question')}
            </span>
            <div className={styles.question}>{q.question}</div>
          </Flexbox>
        ))}
        <div className={styles.divider} />
        <Flexbox gap={8}>
          <span className={styles.label}>
            {t('builtins.lobe-claude-code.askUserQuestion.reply')}
          </span>
          <Flexbox horizontal align="flex-start" gap={8}>
            <Icon className={styles.check} icon={PenLine} size={14} />
            <Text className={styles.answer}>{freeformText}</Text>
          </Flexbox>
        </Flexbox>
        {isError && (
          <Text type="warning">{t('builtins.lobe-claude-code.askUserQuestion.noAnswer')}</Text>
        )}
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.container} gap={20}>
      {questions.map((q, idx) => (
        <QABlock answer={answers?.[q.question]} key={`${q.question}-${idx}`} question={q} />
      ))}
      {isError && (
        <Text type="warning">{t('builtins.lobe-claude-code.askUserQuestion.noAnswer')}</Text>
      )}
    </Flexbox>
  );
});

AskUserQuestion.displayName = 'CCAskUserQuestion';

export default AskUserQuestion;
