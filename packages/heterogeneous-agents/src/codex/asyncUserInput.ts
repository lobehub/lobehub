import { z } from 'zod';

export const CODEX_ASYNC_QUESTION = 'askUserQuestionAsync';

export const isCodexAsyncQuestion = (tool: { apiName: string; identifier: string }) =>
  tool.identifier === 'codex' && tool.apiName === CODEX_ASYNC_QUESTION;

const nonBlank = z.string().refine((value) => value.trim().length > 0);

export const codexAsyncQuestionsSchema = z
  .array(z.object({ options: z.array(nonBlank).min(1).nullish(), title: nonBlank }))
  .min(1);

const repliesSchema = z
  .array(z.object({ answer: nonBlank, question: nonBlank, questionItemId: nonBlank }))
  .min(1);

type CodexAsyncReplies = z.infer<typeof repliesSchema>;

// Codex CLI and Desktop send async answers as a follow-up user message.
const REPLY_OPEN = '<send_user_message_question_reply>';
const REPLY_CLOSE = '</send_user_message_question_reply>';
const replyBlock =
  /^<send_user_message_question_reply>\n([^\n]+)\n<\/send_user_message_question_reply>$/gm;

export const codexAsyncQuestionId = (itemId: string, index: number) =>
  JSON.stringify(['request_user_input_async', itemId, index]);

export const formatCodexAsyncReplies = (replies: CodexAsyncReplies) =>
  `${REPLY_OPEN}\n${JSON.stringify(replies)}\n${REPLY_CLOSE}`;

const parseReplies = (json: string): CodexAsyncReplies | undefined => {
  try {
    return repliesSchema.safeParse(JSON.parse(json)).data;
  } catch {
    return;
  }
};

export const parseCodexAsyncReplies = (content: string): CodexAsyncReplies =>
  Array.from(content.matchAll(replyBlock), (match) => parseReplies(match[1]) ?? []).flat();

export const displayCodexAsyncReplies = (content: string) =>
  content.replaceAll(replyBlock, (block, json: string) => {
    const replies = parseReplies(json);
    return replies?.map(({ answer, question }) => `${question}\n\n${answer}`).join('\n\n') ?? block;
  });
