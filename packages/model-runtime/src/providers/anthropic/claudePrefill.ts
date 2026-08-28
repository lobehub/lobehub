import type Anthropic from '@anthropic-ai/sdk';

import { shouldDropUnsupportedClaudeAssistantPrefill } from './modelId';

/**
 * Claude 4.6+ (including every Claude 5 model) rejects requests whose
 * conversation ends with an assistant turn — the API treats it as an
 * unsupported assistant prefill and returns 400 before generation starts.
 *
 * A single trailing pop is not enough: failed-run placeholder rows can stack
 * multiple assistant messages at the payload tail, so strip
 * until the conversation ends with a non-assistant turn. Models that still
 * support prefill are left untouched.
 * @see https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prefill-claudes-response
 */
export const stripUnsupportedClaudeAssistantPrefill = (
  model: string,
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] => {
  if (!shouldDropUnsupportedClaudeAssistantPrefill(model)) return messages;

  let end = messages.length;
  while (end > 0 && messages[end - 1].role === 'assistant') end--;

  return end === messages.length ? messages : messages.slice(0, end);
};
