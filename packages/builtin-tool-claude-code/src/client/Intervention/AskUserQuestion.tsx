'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Block, Button, CheckboxGroup, Flexbox, Select, Text } from '@lobehub/ui';
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

const optionsForSelect = (q: AskUserQuestionItem) =>
  q.options.map((opt) => ({
    label: opt.description ? `${opt.label} — ${opt.description}` : opt.label,
    value: opt.label,
  }));

/**
 * CC AskUserQuestion intervention component.
 *
 * Pure form — `onInteractionAction` ({type:'submit'|'skip'|'cancel'}) is the
 * only side effect. The framework's `handleInteractionAction` (or the hetero
 * branch the chat conversation wires up) is responsible for marking
 * `pluginIntervention.status` and forwarding the answer to CC over IPC.
 *
 * Renders one Select per question (multi-select uses CheckboxGroup) plus a
 * countdown that ticks once a second. Submit stays disabled until every
 * question has at least one answer; Skip is always enabled.
 */
const AskUserQuestionIntervention = memo<BuiltinInterventionProps<AskUserQuestionArgs>>(
  ({ args, onInteractionAction }) => {
    const questions = args?.questions ?? [];

    // Question text → selected label(s); single-select stores a string,
    // multi-select stores a string[].
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

    const handleSelect = useCallback((questionText: string, value: string | string[]) => {
      setAnswers((prev) => ({ ...prev, [questionText]: value }));
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
            <Flexbox gap={8} key={`${q.question}-${qIdx}`}>
              <Flexbox horizontal align="center" justify="space-between">
                <Text strong>{q.question}</Text>
                {q.header && <Text type="secondary">{q.header}</Text>}
              </Flexbox>

              {q.multiSelect ? (
                <CheckboxGroup
                  disabled={expired || submitting}
                  options={optionsForSelect(q)}
                  value={(answers[q.question] as string[] | undefined) ?? []}
                  onChange={(vals) => handleSelect(q.question, vals as string[])}
                />
              ) : (
                <Select
                  disabled={expired || submitting}
                  options={optionsForSelect(q)}
                  placeholder="Select an option"
                  style={{ width: '100%' }}
                  value={(answers[q.question] as string | undefined) ?? undefined}
                  onChange={(val) => handleSelect(q.question, val as string)}
                />
              )}
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
