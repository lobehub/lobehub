'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Button, Flexbox, Icon, Tabs, Text, TextArea } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ArrowLeft, Check, PenLine, Send, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';
import { dataSelectors } from '@/features/Conversation/store/slices/data/selectors';
import { useChatStore } from '@/store/chat';

import type { AskUserQuestionArgs, AskUserQuestionItem } from '../../types';

/**
 * Sentinel key the bridge formatter (`AskUserMcpServer.formatAnswerForCC`)
 * looks for to detect escape-mode replies. When present, the payload is just
 * `{ __freeform__: <text> }` (multi-choice picks are intentionally absent)
 * and the text is forwarded to CC verbatim — no `User answers:` framing.
 * Matches the convention `lobe-user-interaction` already uses for its own
 * "Or type directly" escape hatch.
 */
const FREEFORM_PAYLOAD_KEY = '__freeform__';

/**
 * Draft-key prefix for the per-question "write your own" text. Unlike the
 * global escape hatch (`__freeform__`, which replaces the whole form), this is
 * scoped to a single question: the user keeps the multi-choice form but writes
 * a custom answer for one question. Stored in the draft as
 * `__custom__:<question text>` so it round-trips through the single
 * `askUserDraft` plugin-state map without a second store key. The text is
 * merged into that question's submit answer at send time, so the bridge and
 * the completed Render — which already handle arbitrary label strings — need
 * no changes.
 */
const CUSTOM_PREFIX = '__custom__:';

/**
 * Server-side bridge timeout (matches `AskUserMcpServer.pendingTimeoutMs`).
 * Not strictly synchronized — server is authoritative — but keeps the on-screen
 * countdown close to reality without plumbing a deadline through every layer.
 */
const COUNTDOWN_MS = 5 * 60 * 1000;

/** Key under tool message `pluginState` where in-progress draft answers live. */
const DRAFT_PLUGIN_STATE_KEY = 'askUserDraft';

const formatRemaining = (msLeft: number): string => {
  const totalSec = Math.max(0, Math.floor(msLeft / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

interface SplitDraft {
  answers: Record<string, string | string[]>;
  custom: Record<string, string>;
  freeform: string;
}

/**
 * A persisted draft co-mingles three kinds of entry under one map:
 *   - `__freeform__`           → global escape-mode text
 *   - `__custom__:<question>`  → per-question "write your own" text
 *   - `<question>`             → multi-choice picks
 * Split them so each piece of state owns its own slice and a stale key from
 * one mode never leaks into another's submit payload.
 */
const splitDraft = (draft: Record<string, string | string[]> | undefined): SplitDraft => {
  const answers: Record<string, string | string[]> = {};
  const custom: Record<string, string> = {};
  let freeform = '';
  for (const [key, value] of Object.entries(draft ?? {})) {
    if (key === FREEFORM_PAYLOAD_KEY) {
      if (typeof value === 'string') freeform = value;
    } else if (key.startsWith(CUSTOM_PREFIX)) {
      if (typeof value === 'string') custom[key.slice(CUSTOM_PREFIX.length)] = value;
    } else {
      answers[key] = value;
    }
  }
  return { answers, custom, freeform };
};

/**
 * Recompose the flat `askUserDraft` map from the split state. Picks and
 * per-question custom text are always carried (so toggling escape on/off or
 * remounting restores the form); the global freeform key is added only while
 * escape mode is the active surface.
 */
const composeDraft = (
  answers: Record<string, string | string[]>,
  custom: Record<string, string>,
  escape: { active: boolean; text: string },
): Record<string, string | string[]> => {
  const draft: Record<string, string | string[]> = { ...answers };
  for (const [question, text] of Object.entries(custom)) {
    if (text.trim().length > 0) draft[CUSTOM_PREFIX + question] = text;
  }
  if (escape.active && escape.text.length > 0) draft[FREEFORM_PAYLOAD_KEY] = escape.text;
  return draft;
};

/** A question counts as answered when it has a pick or non-empty custom text. */
const isQuestionAnswered = (
  q: AskUserQuestionItem,
  answers: Record<string, string | string[]>,
  custom: Record<string, string>,
): boolean => {
  if (custom[q.question]?.trim()) return true;
  const a = answers[q.question];
  return q.multiSelect ? Array.isArray(a) && a.length > 0 : !!a;
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Per-question "write your own" input — sits as the last row in the option
  // stack so it reads as one more choice rather than a separate control.
  customInput: css`
    margin-block-start: 2px;
  `,
  // "Or type directly" / "Back to options" link — slim secondary text that
  // sits alongside Skip in the action bar; matches the
  // `lobe-user-interaction` escape-toggle styling so the two flows feel
  // like the same control.
  escapeLink: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    transition: color 0.12s ease;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  // Card sits inline with the chat — no surrounding panel chrome. Hover
  // tints the row so the stack reads as clickable; selection swaps to a
  // filled `colorPrimaryBg` so the pick is visually weighty.
  option: css`
    cursor: pointer;

    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 8px;

    transition: background 0.12s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  optionCheck: css`
    flex-shrink: 0;
    color: ${cssVar.colorPrimary};
  `,
  optionDescription: css`
    font-size: 12px;
    line-height: 1.45;
    color: ${cssVar.colorTextSecondary};
  `,
  // Neutral 1/2/3/4 chip — stays the same colour whether selected or not so
  // the selection signal lives on the filled background + checkmark.
  optionIndex: css`
    flex-shrink: 0;

    box-sizing: border-box;
    width: 22px;
    height: 22px;
    border-radius: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;

    background: ${cssVar.colorFillTertiary};
  `,
  optionLabel: css`
    font-weight: 500;
  `,
  optionSelected: css`
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
}));

interface OptionCardProps {
  description?: string;
  disabled?: boolean;
  index: number;
  label: string;
  onToggle: () => void;
  selected: boolean;
}

/**
 * One numbered option in a question. Outlined when picked, neutral otherwise;
 * a right-side checkmark seals the selection so the state reads cleanly even
 * with the number chip kept neutral.
 */
const OptionCard = memo<OptionCardProps>(
  ({ index, label, description, selected, disabled, onToggle }) => (
    <Flexbox
      horizontal
      align="center"
      aria-selected={selected}
      className={cx(styles.option, selected && styles.optionSelected)}
      gap={12}
      role="option"
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <span className={styles.optionIndex}>{index}</span>
      <Flexbox flex={1} gap={2}>
        <Text className={styles.optionLabel}>{label}</Text>
        {description && <span className={styles.optionDescription}>{description}</span>}
      </Flexbox>
      {selected && <Icon className={styles.optionCheck} icon={Check} size={16} />}
    </Flexbox>
  ),
);

OptionCard.displayName = 'CCAskUserQuestionOption';

interface QuestionPanelProps {
  answer: string | string[] | undefined;
  customValue: string;
  disabled: boolean;
  onCustomChange: (q: AskUserQuestionItem, value: string) => void;
  onToggle: (q: AskUserQuestionItem, label: string) => void;
  question: AskUserQuestionItem;
}

const QuestionPanel = memo<QuestionPanelProps>(
  ({ question, answer, customValue, disabled, onToggle, onCustomChange }) => {
    const { t } = useTranslation('tool');
    const isOptionSelected = (label: string): boolean =>
      question.multiSelect ? Array.isArray(answer) && answer.includes(label) : answer === label;

    return (
      <Flexbox gap={10}>
        <Flexbox horizontal align="center" gap={8}>
          {question.header && <Text type="secondary">{question.header}</Text>}
          {question.multiSelect && (
            <Text fontSize={12} type="secondary">
              {t('claudeCode.askUserQuestion.multiSelectTag')}
            </Text>
          )}
        </Flexbox>
        <Text strong>{question.question}</Text>

        <Flexbox gap={4} role="listbox">
          {question.options.map((opt, optIdx) => (
            <OptionCard
              description={opt.description}
              disabled={disabled}
              index={optIdx + 1}
              key={opt.label}
              label={opt.label}
              selected={isOptionSelected(opt.label)}
              onToggle={() => onToggle(question, opt.label)}
            />
          ))}
          {/* Last item: let the user write their own answer for this question. */}
          <TextArea
            autoSize={{ maxRows: 4, minRows: 1 }}
            className={styles.customInput}
            disabled={disabled}
            placeholder={t('claudeCode.askUserQuestion.customOption.placeholder')}
            value={customValue}
            variant="filled"
            onChange={(e) => onCustomChange(question, e.target.value)}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

QuestionPanel.displayName = 'CCAskUserQuestionPanel';

/**
 * CC AskUserQuestion intervention component.
 *
 * Pure form — `onInteractionAction` ({type:'submit'|'skip'}) is the only
 * outbound side effect. The framework's `handleInteractionAction` (or the
 * hetero branch the chat conversation wires up) is responsible for marking
 * `pluginIntervention.status` and forwarding the answer to CC over IPC.
 *
 * Answering a question
 * - Pick one of the numbered options, or
 * - Write your own in the trailing input. Single-select treats the two as
 *   mutually exclusive (typing clears the pick and vice-versa); multi-select
 *   appends the custom text as an extra entry alongside the checked options.
 *
 * Layout
 * - One question → renders the question + options directly, no tab strip.
 * - Multiple questions → top tab bar (Q1, Q2, …), one panel visible at a
 *   time. Picking an answer auto-advances to the next unanswered question
 *   so the user sweeps through without re-clicking the tabs.
 *
 * Draft persistence
 * - Per-message state lives on the tool message's `pluginState.askUserDraft`
 *   (see `setInterventionDraft` in the chat store). HMR reloads, store
 *   re-mounts, and tab switches all keep the partial answers around — only
 *   a fresh `tool_use` (different toolCallId / messageId) starts blank.
 */
const AskUserQuestionIntervention = memo<BuiltinInterventionProps<AskUserQuestionArgs>>(
  ({ args, messageId, onInteractionAction }) => {
    const { t } = useTranslation('tool');
    const questions = args?.questions ?? [];

    // Persisted draft (survives unmount / HMR / refresh) — read from the tool
    // message's pluginState so the form stays where the user left it.
    const persistedDraft = useConversationStore((s) => {
      const msg = dataSelectors.getDbMessageById(messageId)(s);
      return (
        msg?.pluginState as { [DRAFT_PLUGIN_STATE_KEY]?: Record<string, string | string[]> }
      )?.[DRAFT_PLUGIN_STATE_KEY];
    });
    const setInterventionDraft = useChatStore((s) => s.setInterventionDraft);

    // Split the persisted draft into its three slices (picks / per-question
    // custom text / global freeform). Each `useState` lazy-initializer runs
    // once at mount, so re-splitting per slot is cheap and avoids leaking a
    // stale `__freeform__` / `__custom__:` key into the form-mode payload.
    const [answers, setAnswers] = useState<Record<string, string | string[]>>(
      () => splitDraft(persistedDraft).answers,
    );
    const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(
      () => splitDraft(persistedDraft).custom,
    );
    // Escape-mode mirrors `lobe-user-interaction`'s "Or type directly"
    // toggle — the whole form is replaced by one freeform box. Persisted text
    // under the `__freeform__` key restores the user back into escape mode on
    // remount; an empty draft starts in form mode.
    const [escapeText, setEscapeText] = useState<string>(() => splitDraft(persistedDraft).freeform);
    const [escapeActive, setEscapeActive] = useState<boolean>(
      () => splitDraft(persistedDraft).freeform.length > 0,
    );
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState<string>(() => {
      // Resume on the first unanswered question so coming back lands the user
      // where they left off rather than always at Q1.
      const { answers: a, custom } = splitDraft(persistedDraft);
      const firstUnanswered = questions.findIndex((q) => !isQuestionAnswered(q, a, custom));
      return String(firstUnanswered >= 0 ? firstUnanswered : 0);
    });

    // Mounted-time deadline; server has its own clock and will return
    // isError if it expires first. Drift of a few seconds is fine.
    const deadline = useMemo(() => Date.now() + COUNTDOWN_MS, []);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }, []);
    const expired = now >= deadline;

    const handleToggle = useCallback(
      (q: AskUserQuestionItem, label: string) => {
        let nextAnswers: Record<string, string | string[]>;
        if (q.multiSelect) {
          const current = (answers[q.question] as string[] | undefined) ?? [];
          const updated = current.includes(label)
            ? current.filter((x) => x !== label)
            : [...current, label];
          nextAnswers = { ...answers, [q.question]: updated };
        } else {
          nextAnswers = { ...answers, [q.question]: label };
        }

        // Single-select picks are mutually exclusive with that question's
        // custom text — picking an option drops any "write your own" text.
        // Multi-select keeps custom text (it's an additive entry).
        let nextCustom = customAnswers;
        if (!q.multiSelect && customAnswers[q.question]) {
          const { [q.question]: _drop, ...rest } = customAnswers;
          nextCustom = rest;
        }

        setAnswers(nextAnswers);
        if (nextCustom !== customAnswers) setCustomAnswers(nextCustom);
        setInterventionDraft(
          messageId,
          composeDraft(nextAnswers, nextCustom, { active: escapeActive, text: escapeText }),
        );

        // Single-select auto-advance: if there's a next unanswered question,
        // jump to it. Multi-select stays on the same panel so the user can
        // toggle additional options.
        if (!q.multiSelect && questions.length > 1) {
          const nextUnanswered = questions.findIndex(
            (qq) => qq.question !== q.question && !isQuestionAnswered(qq, nextAnswers, nextCustom),
          );
          if (nextUnanswered >= 0) setActiveTab(String(nextUnanswered));
        }
      },
      [
        answers,
        customAnswers,
        escapeActive,
        escapeText,
        messageId,
        questions,
        setInterventionDraft,
      ],
    );

    const handleCustomChange = useCallback(
      (q: AskUserQuestionItem, value: string) => {
        const nextCustom = { ...customAnswers, [q.question]: value };

        // Single-select: writing your own answer clears the picked option so
        // the two stay mutually exclusive. Multi-select keeps the checks —
        // custom text rides along as an additive entry.
        let nextAnswers = answers;
        if (!q.multiSelect && value.trim() && answers[q.question]) {
          const { [q.question]: _drop, ...rest } = answers;
          nextAnswers = rest;
        }

        setCustomAnswers(nextCustom);
        if (nextAnswers !== answers) setAnswers(nextAnswers);
        setInterventionDraft(
          messageId,
          composeDraft(nextAnswers, nextCustom, { active: escapeActive, text: escapeText }),
        );
      },
      [answers, customAnswers, escapeActive, escapeText, messageId, setInterventionDraft],
    );

    /**
     * Build the form-mode submit payload: each question maps to its picks,
     * its custom text, or both (multi-select appends custom as an extra
     * entry). Shared by the explicit Submit button and the timeout fallback
     * so both stay in lockstep.
     */
    const buildSubmitPayload = useCallback((): Record<string, string | string[]> => {
      const payload: Record<string, string | string[]> = {};
      for (const q of questions) {
        const custom = customAnswers[q.question]?.trim();
        if (q.multiSelect) {
          const picks = Array.isArray(answers[q.question]) ? (answers[q.question] as string[]) : [];
          const merged = custom ? [...picks, custom] : picks;
          if (merged.length > 0) payload[q.question] = merged;
        } else if (custom) {
          payload[q.question] = custom;
        } else if (answers[q.question]) {
          payload[q.question] = answers[q.question];
        }
      }
      return payload;
    }, [answers, customAnswers, questions]);

    /**
     * Submit `payload` exactly as given. Used by both the explicit "Submit"
     * button (with whatever the user picked) and the timeout fallback (with
     * option 1 of each unanswered question merged in).
     */
    const submitWith = useCallback(
      async (payload: Record<string, string | string[]>) => {
        if (!onInteractionAction || submitting) return;
        setSubmitting(true);
        try {
          await onInteractionAction({ payload, type: 'submit' });
        } catch (err) {
          console.error('[AskUserQuestion] submit failed:', err);
          setSubmitting(false);
        }
      },
      [onInteractionAction, submitting],
    );

    const handleEscapeTextChange = useCallback(
      (value: string) => {
        setEscapeText(value);
        // Persist the freeform text alongside the (hidden) form picks so a
        // refresh resumes here; the picks survive a toggle back to the form.
        setInterventionDraft(
          messageId,
          composeDraft(answers, customAnswers, { active: true, text: value }),
        );
      },
      [answers, customAnswers, messageId, setInterventionDraft],
    );

    const handleEscapeToggle = useCallback(() => {
      setEscapeActive((prev) => {
        const next = !prev;
        // Mirror the toggle into the draft: turning escape ON saves the
        // current text (so a refresh resumes here); turning it OFF strips
        // `__freeform__` so the next mount lands back in form mode.
        setInterventionDraft(
          messageId,
          composeDraft(answers, customAnswers, { active: next, text: escapeText }),
        );
        return next;
      });
    }, [answers, customAnswers, escapeText, messageId, setInterventionDraft]);

    const handleSubmit = useCallback(() => {
      if (escapeActive) {
        // Escape mode is mutually exclusive with picks — send the text alone
        // under `__freeform__`. Bridge formatter forwards it to CC verbatim.
        void submitWith({ [FREEFORM_PAYLOAD_KEY]: escapeText.trim() });
      } else {
        void submitWith(buildSubmitPayload());
      }
    }, [buildSubmitPayload, escapeActive, escapeText, submitWith]);

    const handleSkip = useCallback(async () => {
      if (!onInteractionAction || submitting) return;
      setSubmitting(true);
      try {
        await onInteractionAction({ type: 'skip' });
      } catch (err) {
        console.error('[AskUserQuestion] skip failed:', err);
        setSubmitting(false);
      }
    }, [onInteractionAction, submitting]);

    const allAnswered = useMemo(
      () => questions.every((q) => isQuestionAnswered(q, answers, customAnswers)),
      [answers, customAnswers, questions],
    );

    // Timeout fallback: when the countdown hits zero and the user hasn't
    // submitted, fill in option 1 of each unanswered question and submit.
    // Beats letting the server-side bridge time out into a `cancelled`
    // result — the model gets a structured answer it can act on instead of
    // a "user didn't respond" isError. Single-shot via `submitting` guard.
    //
    // Escape-mode special case: if the user is in escape mode with non-empty
    // text when the countdown hits zero, submit that text as-is rather than
    // discarding their work and falling back to option 1.
    useEffect(() => {
      if (!expired || submitting || questions.length === 0) return;
      if (escapeActive && escapeText.trim().length > 0) {
        void submitWith({ [FREEFORM_PAYLOAD_KEY]: escapeText.trim() });
        return;
      }
      // Start from whatever the user has picked / typed, then backfill option
      // 1 for any question still left untouched.
      const fallback = buildSubmitPayload();
      for (const q of questions) {
        if (fallback[q.question] == null && q.options.length > 0) {
          const first = q.options[0].label;
          fallback[q.question] = q.multiSelect ? [first] : first;
        }
      }
      void submitWith(fallback);
    }, [expired, submitting, questions, escapeActive, escapeText, buildSubmitPayload, submitWith]);

    const isMulti = questions.length > 1;
    const activeQuestion = questions[Number(activeTab)] ?? questions[0];
    const isSubmitDisabled = escapeActive
      ? !escapeText.trim() || submitting || expired
      : !allAnswered || expired || submitting;

    return (
      <Flexbox gap={12}>
        {!escapeActive && isMulti && (
          <Tabs
            compact
            activeKey={activeTab}
            items={questions.map((q, idx) => {
              const done = isQuestionAnswered(q, answers, customAnswers);
              return {
                key: String(idx),
                label: (
                  <Flexbox horizontal align="center" gap={6}>
                    <Text>Q{idx + 1}</Text>
                    {done && <Icon icon={Check} size={12} />}
                  </Flexbox>
                ),
              };
            })}
            onChange={(key) => setActiveTab(key as string)}
          />
        )}

        {escapeActive ? (
          <TextArea
            autoSize={{ maxRows: 8, minRows: 3 }}
            disabled={expired || submitting}
            placeholder={t('claudeCode.askUserQuestion.escape.placeholder')}
            value={escapeText}
            variant="filled"
            onChange={(e) => handleEscapeTextChange(e.target.value)}
          />
        ) : (
          activeQuestion && (
            <QuestionPanel
              answer={answers[activeQuestion.question]}
              customValue={customAnswers[activeQuestion.question] ?? ''}
              disabled={expired || submitting}
              question={activeQuestion}
              onCustomChange={handleCustomChange}
              onToggle={handleToggle}
            />
          )
        )}

        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Flexbox horizontal align="center" gap={12}>
            {escapeActive ? (
              <Text
                className={styles.escapeLink}
                fontSize={12}
                type="secondary"
                onClick={expired || submitting ? undefined : handleEscapeToggle}
              >
                <Icon icon={ArrowLeft} size={12} />
                {t('claudeCode.askUserQuestion.escape.back')}
              </Text>
            ) : (
              <Text
                className={styles.escapeLink}
                fontSize={12}
                type="secondary"
                onClick={expired || submitting ? undefined : handleEscapeToggle}
              >
                {t('claudeCode.askUserQuestion.escape.enter')}
                <Icon icon={PenLine} size={12} />
              </Text>
            )}
            <Text fontSize={12} type="secondary">
              {expired
                ? t('claudeCode.askUserQuestion.timeExpired')
                : t('claudeCode.askUserQuestion.timeRemaining', {
                    time: formatRemaining(deadline - now),
                  })}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={8}>
            <Button disabled={submitting} icon={X} onClick={handleSkip}>
              {t('claudeCode.askUserQuestion.skip')}
            </Button>
            <Button
              disabled={isSubmitDisabled}
              icon={Send}
              loading={submitting}
              type="primary"
              onClick={handleSubmit}
            >
              {t('claudeCode.askUserQuestion.submit')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

AskUserQuestionIntervention.displayName = 'CCAskUserQuestionIntervention';

export default AskUserQuestionIntervention;
