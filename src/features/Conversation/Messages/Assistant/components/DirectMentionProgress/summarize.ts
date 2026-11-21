import { LOADING_FLAT } from '@lobechat/const';
import type { UIChatMessage } from '@lobechat/types';

const MAX_LINE = 80;

export interface ThreadProgress {
  /** What the child is doing right now. */
  activity?: { text: string; type: 'thinking' } | { name: string; type: 'tool' };
  /** The newest line of the answer it is writing. */
  text?: string;
}

/** Last non-empty line, cut from the front so the newest words stay visible. */
const tailLine = (value?: string | null): string | undefined => {
  if (!value || value === LOADING_FLAT) return;
  const line = value
    .split('\n')
    .map((part) => part.trim())
    .findLast(Boolean);
  if (!line) return;

  return line.length > MAX_LINE ? `…${line.slice(-MAX_LINE)}` : line;
};

/** One-glance progress of a direct @Agent child, read from its thread transcript. */
export const summarizeThreadProgress = (
  transcript: UIChatMessage[],
  threadId: string,
): ThreadProgress => {
  // The transcript also carries the conversation the thread reads; progress is
  // the thread's own.
  const messages = transcript.filter((message) => message.threadId === threadId);
  const replies = messages.filter((message) => message.role === 'assistant');
  const current = replies.at(-1);
  if (!current) return {};

  const answeredCalls = new Set(
    messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id),
  );
  const pendingTool = current.tools?.find((tool) => !answeredCalls.has(tool.id));
  const thinking = tailLine(current.reasoning?.content);
  const text = replies.map((reply) => tailLine(reply.content)).findLast(Boolean);

  const activity: ThreadProgress['activity'] = pendingTool
    ? { name: pendingTool.apiName || pendingTool.identifier, type: 'tool' }
    : thinking
      ? { text: thinking, type: 'thinking' }
      : undefined;

  return { ...(activity && { activity }), ...(text && { text }) };
};
