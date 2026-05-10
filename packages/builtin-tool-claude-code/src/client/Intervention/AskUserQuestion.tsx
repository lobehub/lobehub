'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Block, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Send, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import type { AskUserQuestionArgs, AskUserQuestionItem } from '../../types';

/**
 * Server-side bridge timeout (matches `AskUserMcpServer.pendingTimeoutMs`).
 * Not strictly synchronized — server is authoritative — but keeps the on-screen
 * countdown close to reality without plumbing a deadline through every layer.
 */
const COUNTDOWN_MS = 5 * 60 * 1000;

const formatRemaining = (msLeft: number): string => {
  const totalSec = Math.max(0, Math.floor(msLeft / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Numbered option card. Outlined by default, primary tinted when selected.
  // Hover gets a subtle fill so the card reads as clickable even before pick.
  option: css`
    cursor: pointer;

    padding-block: 10px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;

    transition: all 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  optionDescription: css`
    font-size: 12px;
    line-height: 1.45;
    color: ${cssVar.colorTextSecondary};
  `,
  // 1/2/3/4 chip — small enough to sit alongside the label without crowding.
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
  optionIndexSelected: css`
    color: ${cssVar.colorTextLightSolid};
    background: ${cssVar.colorPrimary};
  `,
  optionLabel: css`
    font-weight: 500;
  `,
  optionSelected: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
  // Visual gutter between consecutive questions; first question has no top
  // margin/border so the form starts clean.
  questionBlock: css`
    &:not(:first-of-type) {
      margin-block-start: 8px;
      padding-block-start: 16px;
      border-block-start: 1px dashed ${cssVar.colorBorderSecondary};
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
 * One numbered option in a question. Whole card is the click target so the
 * label, description, and number all act as one selectable unit. Selected
 * state lights up with `colorPrimary` for both the index chip and the
 * outline — gives the form a clear "you picked this" signal that survives
 * keyboard / screen-reader enumeration as well as visual scan.
 */
const OptionCard = memo<OptionCardProps>(
  ({ index, label, description, selected, disabled, onToggle }) => (
    <Flexbox
      horizontal
      align="flex-start"
      aria-selected={selected}
      className={cx(styles.option, selected && styles.optionSelected)}
      gap={12}
      role="option"
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <span className={cx(styles.optionIndex, selected && styles.optionIndexSelected)}>
        {index}
      </span>
      <Flexbox flex={1} gap={2}>
        <Text className={styles.optionLabel}>{label}</Text>
        {description && <span className={styles.optionDescription}>{description}</span>}
      </Flexbox>
    </Flexbox>
  ),
);

OptionCard.displayName = 'CCAskUserQuestionOption';

/**
 * CC AskUserQuestion intervention component.
 *
 * Pure form — `onInteractionAction` ({type:'submit'|'skip'}) is the only
 * side effect. The framework's `handleInteractionAction` (or the hetero
 * branch the chat conversation wires up) is responsible for marking
 * `pluginIntervention.status` and forwarding the answer to CC over IPC.
 *
 * Each question renders as a stack of numbered option cards (1/2/3/4 — CC
 * caps options at 4). Multi-select questions accept any subset; single-
 * select replaces. Multiple questions are stacked with a dashed divider
 * and a `Q1/N` tag so the user always knows where they are. Submit stays
 * disabled until every question has at least one pick; Skip is always on.
 */
const AskUserQuestionIntervention = memo<BuiltinInterventionProps<AskUserQuestionArgs>>(
  ({ args, onInteractionAction }) => {
    const questions = args?.questions ?? [];

    // Question text → selected label(s); single-select stores a string,
    // multi-select stores a string[]. Question text is unique per call by
    // CC's contract, so it's safe to use as the dictionary key.
    const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
    const [submitting, setSubmitting] = useState(false);

    // Mounted-time deadline; server has its own clock and will return
    // isError if it expires first. Drift of a few seconds is fine.
    const deadline = useMemo(() => Date.now() + COUNTDOWN_MS, []);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }, []);
    const expired = now >= deadline;

    const isOptionSelected = useCallback(
      (q: AskUserQuestionItem, label: string): boolean => {
        const a = answers[q.question];
        if (q.multiSelect) return Array.isArray(a) && a.includes(label);
        return a === label;
      },
      [answers],
    );

    const handleToggle = useCallback((q: AskUserQuestionItem, label: string) => {
      setAnswers((prev) => {
        if (q.multiSelect) {
          const current = (prev[q.question] as string[] | undefined) ?? [];
          const next = current.includes(label)
            ? current.filter((x) => x !== label)
            : [...current, label];
          return { ...prev, [q.question]: next };
        }
        return { ...prev, [q.question]: label };
      });
    }, []);

    const handleSubmit = useCallback(async () => {
      if (!onInteractionAction || submitting) return;
      setSubmitting(true);
      try {
        await onInteractionAction({ payload: answers, type: 'submit' });
      } catch (err) {
        console.error('[AskUserQuestion] submit failed:', err);
        setSubmitting(false);
      }
    }, [answers, onInteractionAction, submitting]);

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

    return (
      <Block padding={16} variant="outlined" width="100%">
        <Flexbox gap={16}>
          {questions.map((q, qIdx) => (
            <Flexbox className={styles.questionBlock} gap={10} key={`${q.question}-${qIdx}`}>
              <Flexbox horizontal align="center" gap={8}>
                {questions.length > 1 && (
                  <Tag bordered={false}>
                    Q{qIdx + 1}/{questions.length}
                  </Tag>
                )}
                {q.header && <Text type="secondary">{q.header}</Text>}
                {q.multiSelect && (
                  <Text fontSize={12} type="secondary">
                    (multi-select)
                  </Text>
                )}
              </Flexbox>
              <Text strong>{q.question}</Text>

              <Flexbox gap={6} role="listbox">
                {q.options.map((opt, optIdx) => (
                  <OptionCard
                    description={opt.description}
                    disabled={expired || submitting}
                    index={optIdx + 1}
                    key={opt.label}
                    label={opt.label}
                    selected={isOptionSelected(q, opt.label)}
                    onToggle={() => handleToggle(q, opt.label)}
                  />
                ))}
              </Flexbox>
            </Flexbox>
          ))}

          <Flexbox horizontal align="center" gap={8} justify="space-between">
            <Text fontSize={12} type="secondary">
              {expired
                ? 'Time expired — answer is no longer accepted.'
                : `Time remaining: ${formatRemaining(deadline - now)}`}
            </Text>
            <Flexbox horizontal gap={8}>
              <Button disabled={submitting} icon={X} size="small" onClick={handleSkip}>
                Skip
              </Button>
              <Button
                disabled={!allAnswered || expired || submitting}
                icon={Send}
                loading={submitting}
                size="small"
                type="primary"
                onClick={handleSubmit}
              >
                Submit
              </Button>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

AskUserQuestionIntervention.displayName = 'CCAskUserQuestionIntervention';

export default AskUserQuestionIntervention;
