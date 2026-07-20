'use client';

import { normalizeAskUserQuestions } from '@lobechat/shared-tool-ui/ask-user';
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
    font-size: 14px;
    line-height: 1.5;
    color: ${cssVar.colorText};
  `,
  check: css`
    flex-shrink: 0;
    margin-block-start: 4px;
    color: ${cssVar.colorPrimary};
  `,
  container: css`
    padding-block: 4px;
  `,
  description: css`
    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  divider: css`
    align-self: stretch;
    height: 1px;
    margin-block: 4px;
    background: ${cssVar.colorFillSecondary};
  `,
  /** The question's own short `header`, riding along the title line — costs no row. */
  header: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-size: 11px;
    font-weight: 400;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  /** Ordinal rail. Its presence is what groups the blocks — hence no hairline. */
  ordinal: css`
    flex-shrink: 0;

    width: 22px;
    padding-block-start: 2px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
    color: ${cssVar.colorTextQuaternary};
  `,
  question: css`
    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
    color: ${cssVar.colorText};
  `,
  titleRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
  `,
  unanswered: css`
    padding-inline-start: 22px;
    font-size: 14px;
    line-height: 1.5;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface AnswerLineProps {
  description?: string;
  icon: typeof Check;
  text: string;
}

const AnswerLine = memo<AnswerLineProps>(({ icon, text, description }) => (
  <Flexbox horizontal align="flex-start" gap={8}>
    <Icon className={styles.check} icon={icon} size={14} />
    <Flexbox gap={1}>
      <span className={styles.answer}>{text}</span>
      {description && <span className={styles.description}>{description}</span>}
    </Flexbox>
  </Flexbox>
));

AnswerLine.displayName = 'CCAskUserAnswerLine';

interface QABlockProps {
  answer?: string | string[];
  /** 1-based ordinal, only passed when the form carries more than one question. */
  index?: number;
  question: AskUserQuestionItem;
}

/**
 * One question/answer pair, laid out flat (no nested cards, no field labels): the
 * question line, then the pick(s) beneath it as check-prefixed rows with their
 * description underneath. Multi-select fans out into several rows.
 *
 * With more than one question, `index` turns on an ordinal rail (`Q1`, `Q2`) and
 * the question's own `header` rides along the title line as a trailing chip. The
 * rail is what separates the blocks — it doubles as the grouping signal, so no
 * hairline is drawn between them. A lone question gets neither: `Q1` would imply a
 * `Q2` that doesn't exist, and the Inspector already names it.
 *
 * When `answer` is absent — older messages persisted before structured storage —
 * we show a muted placeholder so the row still reads as an answer slot.
 */
const QABlock = memo<QABlockProps>(({ question, answer, index }) => {
  const { t } = useTranslation('plugin');
  const labels: string[] = Array.isArray(answer) ? answer : answer ? [answer] : [];
  const optionByLabel = new Map(question.options.map((o) => [o.label, o]));

  return (
    <Flexbox align="flex-start" horizontal={!!index}>
      {!!index && <span className={styles.ordinal}>{`Q${index}`}</span>}
      <Flexbox gap={6}>
        <div className={index ? styles.titleRow : undefined}>
          <span className={styles.question}>{question.question}</span>
          {!!index && question.header && <span className={styles.header}>{question.header}</span>}
        </div>
        {labels.length > 0 ? (
          <Flexbox gap={6}>
            {labels.map((label) => {
              const opt = optionByLabel.get(label);
              return (
                <AnswerLine
                  icon={Check}
                  key={label}
                  text={label}
                  description={
                    opt?.description && opt.description !== label ? opt.description : undefined
                  }
                />
              );
            })}
          </Flexbox>
        ) : (
          <span className={styles.unanswered}>
            {t('builtins.lobe-claude-code.askUserQuestion.notAnswered')}
          </span>
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
  const questions = normalizeAskUserQuestions(args);
  const answers = pluginState?.askUserAnswers;
  const freeform = answers?.['__freeform__'];
  const freeformText = typeof freeform === 'string' ? freeform.trim() : '';
  const isError = !!pluginError;
  const multiple = questions.length > 1;

  // Escape-mode reply: the user opted out of the multi-choice form and
  // wrote freeform text instead. The form picks are intentionally absent,
  // so render the questions for context plus the typed reply as its own line —
  // Q&A pairs would render as empty rows.
  if (freeformText) {
    return (
      <Flexbox className={styles.container} gap={12}>
        {questions.map((q, idx) => (
          <Flexbox align="flex-start" horizontal={multiple} key={`${q.question}-${idx}`}>
            {multiple && <span className={styles.ordinal}>{`Q${idx + 1}`}</span>}
            <div className={multiple ? styles.titleRow : undefined}>
              <span className={styles.question}>{q.question}</span>
              {multiple && q.header && <span className={styles.header}>{q.header}</span>}
            </div>
          </Flexbox>
        ))}
        {/* The reply answers the whole form, not the last question — with several
            questions on screen that scope needs a rule to be legible. */}
        {multiple && <div className={styles.divider} />}
        <AnswerLine icon={PenLine} text={freeformText} />
        {isError && (
          <Text type="warning">{t('builtins.lobe-claude-code.askUserQuestion.noAnswer')}</Text>
        )}
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.container} gap={12}>
      {questions.map((q, idx) => (
        <QABlock
          answer={answers?.[q.question]}
          index={multiple ? idx + 1 : undefined}
          key={`${q.question}-${idx}`}
          question={q}
        />
      ))}
      {isError && (
        <Text type="warning">{t('builtins.lobe-claude-code.askUserQuestion.noAnswer')}</Text>
      )}
    </Flexbox>
  );
});

AskUserQuestion.displayName = 'CCAskUserQuestion';

export default AskUserQuestion;
