'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Button, Flexbox, Icon, Tabs, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Check, Send, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
import { dataSelectors } from '@/features/Conversation/store/slices/data/selectors';
import { useChatStore } from '@/store/chat';

import type { AskUserQuestionArgs, AskUserQuestionItem } from '../../types';

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

const styles = createStaticStyles(({ css, cssVar }) => ({
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
  disabled: boolean;
  onToggle: (q: AskUserQuestionItem, label: string) => void;
  question: AskUserQuestionItem;
}

const QuestionPanel = memo<QuestionPanelProps>(({ question, answer, disabled, onToggle }) => {
  const isOptionSelected = (label: string): boolean =>
    question.multiSelect ? Array.isArray(answer) && answer.includes(label) : answer === label;

  return (
    <Flexbox gap={10}>
      <Flexbox horizontal align="center" gap={8}>
        {question.header && <Text type="secondary">{question.header}</Text>}
        {question.multiSelect && (
          <Text fontSize={12} type="secondary">
            (multi-select)
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
      </Flexbox>
    </Flexbox>
  );
});

QuestionPanel.displayName = 'CCAskUserQuestionPanel';

/**
 * CC AskUserQuestion intervention component.
 *
 * Pure form — `onInteractionAction` ({type:'submit'|'skip'}) is the only
 * outbound side effect. The framework's `handleInteractionAction` (or the
 * hetero branch the chat conversation wires up) is responsible for marking
 * `pluginIntervention.status` and forwarding the answer to CC over IPC.
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

    const [answers, setAnswers] = useState<Record<string, string | string[]>>(
      () => persistedDraft ?? {},
    );
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState<string>(() => {
      // Resume on the first unanswered question so coming back lands the user
      // where they left off rather than always at Q1.
      const initial = persistedDraft ?? {};
      const firstUnanswered = questions.findIndex((q) => {
        const a = initial[q.question];
        return q.multiSelect ? !Array.isArray(a) || a.length === 0 : !a;
      });
      const idx = firstUnanswered >= 0 ? firstUnanswered : 0;
      return String(idx);
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
        setAnswers((prev) => {
          let next: Record<string, string | string[]>;
          if (q.multiSelect) {
            const current = (prev[q.question] as string[] | undefined) ?? [];
            const updated = current.includes(label)
              ? current.filter((x) => x !== label)
              : [...current, label];
            next = { ...prev, [q.question]: updated };
          } else {
            next = { ...prev, [q.question]: label };
          }
          // Persist to pluginState so the picks survive remount / refresh.
          setInterventionDraft(messageId, next);

          // Single-select auto-advance: if there's a next unanswered question,
          // jump to it. Multi-select stays on the same panel so the user can
          // toggle additional options.
          if (!q.multiSelect && questions.length > 1) {
            const nextUnanswered = questions.findIndex((qq, idx) => {
              if (qq.question === q.question) return false;
              const a = next[qq.question];
              if (idx < 0) return false;
              return qq.multiSelect ? !Array.isArray(a) || a.length === 0 : !a;
            });
            if (nextUnanswered >= 0) setActiveTab(String(nextUnanswered));
          }
          return next;
        });
      },
      [messageId, questions, setInterventionDraft],
    );

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

    const handleSubmit = useCallback(() => submitWith(answers), [answers, submitWith]);

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
      () =>
        questions.every((q) => {
          const a = answers[q.question];
          return q.multiSelect ? Array.isArray(a) && a.length > 0 : !!a;
        }),
      [answers, questions],
    );

    // Timeout fallback: when the countdown hits zero and the user hasn't
    // submitted, fill in option 1 of each unanswered question and submit.
    // Beats letting the server-side bridge time out into a `cancelled`
    // result — the model gets a structured answer it can act on instead of
    // a "user didn't respond" isError. Single-shot via `submitting` guard.
    useEffect(() => {
      if (!expired || submitting || questions.length === 0) return;
      const fallback: Record<string, string | string[]> = { ...answers };
      for (const q of questions) {
        const a = fallback[q.question];
        const unanswered = q.multiSelect ? !Array.isArray(a) || a.length === 0 : !a;
        if (unanswered && q.options.length > 0) {
          const first = q.options[0].label;
          fallback[q.question] = q.multiSelect ? [first] : first;
        }
      }
      void submitWith(fallback);
    }, [expired, submitting, questions, answers, submitWith]);

    const isMulti = questions.length > 1;
    const activeQuestion = questions[Number(activeTab)] ?? questions[0];

    return (
      <Flexbox gap={12}>
        {isMulti && (
          <Tabs
            compact
            activeKey={activeTab}
            items={questions.map((q, idx) => {
              const a = answers[q.question];
              const done = q.multiSelect ? Array.isArray(a) && a.length > 0 : !!a;
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

        {activeQuestion && (
          <QuestionPanel
            answer={answers[activeQuestion.question]}
            disabled={expired || submitting}
            question={activeQuestion}
            onToggle={handleToggle}
          />
        )}

        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Text fontSize={12} type="secondary">
            {expired
              ? 'Time expired — using option 1 of each question.'
              : `Time remaining: ${formatRemaining(deadline - now)} · ` +
                'unanswered questions default to option 1 on timeout.'}
          </Text>
          <Flexbox horizontal gap={8}>
            <Button disabled={submitting} icon={X} onClick={handleSkip}>
              Skip
            </Button>
            <Button
              disabled={!allAnswered || expired || submitting}
              icon={Send}
              loading={submitting}
              type="primary"
              onClick={handleSubmit}
            >
              Submit
            </Button>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

AskUserQuestionIntervention.displayName = 'CCAskUserQuestionIntervention';

export default AskUserQuestionIntervention;
