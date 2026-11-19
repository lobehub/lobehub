import {
  codexAsyncQuestionId,
  codexAsyncQuestionsSchema,
  formatCodexAsyncReplies,
  parseCodexAsyncReplies,
} from '@lobechat/heterogeneous-agents/client';
import { safeParseJSON } from '@lobechat/utils';
import { Block, Text } from '@lobehub/ui';

import ClarificationQuestions, {
  type ClarificationAnswer,
} from '@/features/ClarificationQuestions';
import { useConversationStore } from '@/features/Conversation/store';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';

interface CodexAsyncQuestionProps {
  arguments?: string;
  disableEditing?: boolean;
  toolCallId: string;
}

export const CodexAsyncQuestion = ({
  arguments: requestArgs,
  disableEditing,
  toolCallId,
}: CodexAsyncQuestionProps) => {
  const context = useConversationStore((s) => s.context);
  const canSend =
    useConversationStore((s) => s.transcriptSource === 'chat' && s.composerTarget.writable) &&
    !disableEditing;
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const parsed = codexAsyncQuestionsSchema.safeParse(
    safeParseJSON<{ questions?: unknown }>(requestArgs ?? '')?.questions,
  );
  const questions = (parsed.data ?? []).map(({ title, options }, index) => ({
    header: '',
    id: codexAsyncQuestionId(toolCallId, index),
    options: [...new Set(options)].map((label) => ({ id: label, label })),
    question: title,
  }));
  const isReply = (content: string) =>
    parseCodexAsyncReplies(content).some(({ questionItemId }) =>
      questions.some(({ id }) => id === questionItemId),
    );
  const answered = useConversationStore((s) =>
    s.dbMessages.some((message) => message.role === 'user' && isReply(message.content)),
  );
  const queued = useChatStore((s) =>
    operationSelectors
      .getQueuedMessages(context)(s)
      .some((message) => isReply(message.content)),
  );

  if (questions.length === 0) return null;

  const submit = async (answers: ClarificationAnswer[]) => {
    const replies = answers.flatMap((answer) => {
      const question = questions.find(({ id }) => id === answer.questionId);
      if (!question) return [];
      const option =
        answer.type === 'option' && question.options.find(({ id }) => id === answer.optionId);
      const text =
        answer.type === 'text'
          ? answer.text
          : [option && option.label, answer.note].filter(Boolean).join('\n');
      return [{ answer: text, question: question.question, questionItemId: question.id }];
    });
    if (!replies.length) throw new Error('No Codex question answers');
    let accepted = false;
    await sendMessage({
      message: formatCodexAsyncReplies(replies),
      onMessageAccepted: () => {
        accepted = true;
      },
      preserveComposer: true,
    }).catch((error) => {
      if (!accepted) throw error;
    });
    if (!accepted) throw new Error('Codex question reply was not accepted');
  };

  return (
    <Block gap={8} padding={12} variant={'outlined'}>
      {canSend && !answered && !queued ? (
        <ClarificationQuestions
          draftKey={questions[0].id}
          globalHotkeys={false}
          questions={questions}
          onSubmit={submit}
        />
      ) : (
        questions.map(({ id, question }) => <Text key={id}>{question}</Text>)
      )}
    </Block>
  );
};
