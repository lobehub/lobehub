import { isRecord } from '@lobechat/utils/object';
import { z } from 'zod';

import type { InterventionAnswer } from '../askUser';
import type { ToolRequestUserInputResponse } from './protocol/experimental/ToolRequestUserInputResponse';

const questionSchema = z.object({
  header: z.string().max(200),
  id: z.string().min(1),
  // Secret collection needs its own secure input surface, not a persisted chat form.
  isSecret: z.literal(false),
  options: z
    .array(z.object({ description: z.string().max(1000), label: z.string().min(1).max(200) }))
    .max(16)
    .nullable(),
  question: z.string().min(1).max(4000),
});

export const parseCodexUserInput = (params: unknown) => {
  const request = z
    .object({
      autoResolutionMs: z.number().int().positive().nullish(),
      itemId: z.string().min(1),
      questions: z.array(questionSchema).min(1).max(4),
      threadId: z.string(),
      turnId: z.string(),
    })
    .parse(params);
  if (
    new Set(request.questions.map((q) => q.id)).size !== request.questions.length ||
    new Set(request.questions.map((q) => q.question)).size !== request.questions.length
  )
    throw new Error('Codex user input questions must have unique ids and text');
  return request;
};

export const codexUserInputArguments = (request: ReturnType<typeof parseCodexUserInput>) => ({
  questions: request.questions.map((question) => ({
    header: question.header,
    multiSelect: false,
    options: (question.options ?? []).map(({ description, label }) => ({
      ...(description ? { description } : {}),
      id: label,
      label,
    })),
    question: question.question,
  })),
});

export const codexUserInputResponse = (
  request: ReturnType<typeof parseCodexUserInput>,
  answer: InterventionAnswer,
): ToolRequestUserInputResponse => {
  if (answer.cancelled || !isRecord(answer.result)) return { answers: {} };
  const result = answer.result;
  const entries = request.questions.flatMap<[string, { answers: string[] }]>((question, index) => {
    const value = result[question.question];
    const selected =
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === 'string')
          : [];
    if (index === 0) {
      if (typeof result.__freeform__ === 'string') selected.push(result.__freeform__);
      if (typeof result.__supplement__ === 'string') selected.push(result.__supplement__);
    }
    return selected.length > 0 ? [[question.id, { answers: selected }]] : [];
  });
  return { answers: Object.fromEntries(entries) };
};
