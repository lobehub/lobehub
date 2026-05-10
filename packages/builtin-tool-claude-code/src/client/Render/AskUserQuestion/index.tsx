'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Block, Button, CheckboxGroup, Flexbox, Select, Text } from '@lobehub/ui';
import { Send, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { useChatStore } from '@/store/chat';

import type {
  AskUserQuestionArgs,
  AskUserQuestionItem,
  AskUserQuestionPluginState,
} from '../../../types';

interface AskUserQuestionState {
  askUserQuestion?: AskUserQuestionPluginState;
}

const formatRemaining = (deadlineMs: number, nowMs: number): string => {
  const remainingMs = Math.max(0, deadlineMs - nowMs);
  const totalSec = Math.floor(remainingMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const optionsForSelect = (q: AskUserQuestionItem) =>
  q.options.map((opt) => ({
    label: opt.description ? `${opt.label} — ${opt.description}` : opt.label,
    value: opt.label,
  }));

interface PendingFormProps {
  deadline: number;
  messageId: string;
  questions: AskUserQuestionItem[];
  toolCallId: string;
}

const PendingForm = memo<PendingFormProps>(({ questions, deadline, toolCallId, messageId }) => {
  // question text → selected label(s); single-select stores a string,
  // multi-select stores a string[].
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick every second so the countdown updates.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const operationId = useChatStore((s) => s.messageOperationMap?.[messageId]);
  const expired = now >= deadline;

  const handleSelect = useCallback((questionText: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [questionText]: value }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!operationId || submitting) return;
    setSubmitting(true);
    try {
      await heterogeneousAgentService.submitIntervention({
        operationId,
        result: answers,
        toolCallId,
      });
    } catch (err) {
      console.error('[AskUserQuestion] submit failed:', err);
      setSubmitting(false);
    }
  }, [answers, operationId, submitting, toolCallId]);

  const handleCancel = useCallback(async () => {
    if (!operationId || submitting) return;
    setSubmitting(true);
    try {
      await heterogeneousAgentService.submitIntervention({
        cancelReason: 'user_cancelled',
        cancelled: true,
        operationId,
        toolCallId,
      });
    } catch (err) {
      console.error('[AskUserQuestion] cancel failed:', err);
      setSubmitting(false);
    }
  }, [operationId, submitting, toolCallId]);

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
              : `Time remaining: ${formatRemaining(deadline, now)}`}
          </Text>
          <Flexbox horizontal gap={8}>
            <Button disabled={submitting} icon={X} size="small" onClick={handleCancel}>
              Skip
            </Button>
            <Button
              disabled={!allAnswered || expired || submitting || !operationId}
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
});

PendingForm.displayName = 'CCAskUserQuestionPendingForm';

const AnsweredView = memo<{
  args: AskUserQuestionArgs;
  content?: unknown;
  isError: boolean;
}>(({ args, content, isError }) => {
  const text = typeof content === 'string' ? content : '';
  return (
    <Block padding={12} variant="outlined" width="100%">
      <Flexbox gap={8}>
        {(args?.questions ?? []).map((q, idx) => (
          <Text key={idx} type="secondary">
            {q.question}
          </Text>
        ))}
        {text && <Text>{text}</Text>}
        {isError && (
          <Text type="warning">
            (User did not answer — model will continue without their input.)
          </Text>
        )}
      </Flexbox>
    </Block>
  );
});

AnsweredView.displayName = 'CCAskUserQuestionAnsweredView';

const AskUserQuestion = memo<
  BuiltinRenderProps<AskUserQuestionArgs, AskUserQuestionState, unknown>
>(({ args, content, messageId, pluginError, pluginState }) => {
  const intervention = pluginState?.askUserQuestion;
  if (intervention?.status === 'pending') {
    return (
      <PendingForm
        deadline={intervention.deadline}
        messageId={messageId}
        questions={intervention.questions ?? args?.questions ?? []}
        toolCallId={intervention.toolCallId}
      />
    );
  }
  return <AnsweredView args={args} content={content} isError={!!pluginError} />;
});

AskUserQuestion.displayName = 'CCAskUserQuestion';

export default AskUserQuestion;
