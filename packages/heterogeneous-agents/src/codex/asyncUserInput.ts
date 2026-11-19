import { z } from 'zod';

import type { InterventionAnswer } from '../askUser';
import { codexUserInputResponse } from './requestUserInput';

const nonBlank = z.string().refine((value) => value.trim().length > 0);
const notificationSchema = z.object({
  item: z.object({
    delivery: z.literal('async'),
    id: nonBlank,
    questions: z.array(z.object({ options: z.array(nonBlank).nullish(), title: nonBlank })).min(1),
    type: z.literal('agentMessage'),
  }),
});

export const readCodexAsyncQuestion = (params: unknown) => {
  const item = notificationSchema.safeParse(params).data?.item;
  if (!item) return;
  const questionNames = new Set(['__freeform__', '__supplement__']);
  const questions = item.questions.map(({ options, title }, index) => {
    let question = title;
    for (let suffix = 2; questionNames.has(question); suffix++) {
      question = `${title} (${suffix})`;
    }
    questionNames.add(question);
    return {
      header: '',
      id: JSON.stringify(['request_user_input_async', item.id, index]),
      isSecret: false as const,
      options: [...new Set(options)].map((label) => ({ description: '', label })),
      question,
      title,
    };
  });
  return { itemId: item.id, questions };
};

export const codexAsyncAnswers = (
  request: NonNullable<ReturnType<typeof readCodexAsyncQuestion>>,
  answer: InterventionAnswer,
) => {
  const { answers } = codexUserInputResponse(request, answer);
  return request.questions.flatMap(({ id, title }) => {
    const response = answers[id]?.answers.join('\n');
    return response ? [{ answer: response, question: title, questionItemId: id }] : [];
  });
};

// Codex recognizes the same reply envelope its CLI and Desktop send on the original thread.
export const formatCodexAsyncReplies = (replies: ReturnType<typeof codexAsyncAnswers>) =>
  `<send_user_message_question_reply>\n${JSON.stringify(replies)}\n</send_user_message_question_reply>`;
