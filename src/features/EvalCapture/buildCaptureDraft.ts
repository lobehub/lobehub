/**
 * Turning a conversation turn into an eval case is a slicing problem: the case
 * is one assistant answer, the user turn that asked for it, and everything
 * before that as replayable context.
 */

export interface CaptureSourceMessage {
  content?: unknown;
  id: string;
  role?: string;
}

export interface CaptureDraft {
  /** The answer under scrutiny. Kept as a counter-example, never as `expected`. */
  actualOutput: string;
  /** Conversation replayed before `input`. */
  context: Array<{ content: string; role: string }>;
  /** The user turn the captured answer responded to. */
  input: string;
}

/** Content is a string on most messages and content parts on some. */
export const toPlainText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      const text = (part as { text?: unknown })?.text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('\n');
};

/**
 * Slice a capture out of the rendered conversation.
 *
 * Returns `undefined` when the answer has no user turn before it — an assistant
 * message with nothing that asked for it cannot be replayed as a case, and
 * guessing an input would fabricate the thing under test.
 */
export const buildCaptureDraft = (
  messages: CaptureSourceMessage[],
  assistantMessageId: string,
): CaptureDraft | undefined => {
  const answerIndex = messages.findIndex((message) => message.id === assistantMessageId);
  if (answerIndex < 0) return undefined;

  const answer = messages[answerIndex];
  if (answer.role !== 'assistant') return undefined;

  let inputIndex = -1;
  for (let i = answerIndex - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      inputIndex = i;
      break;
    }
  }
  if (inputIndex < 0) return undefined;

  const input = toPlainText(messages[inputIndex].content);
  if (!input.trim()) return undefined;

  return {
    actualOutput: toPlainText(answer.content),
    // `system` is harness context rather than a turn someone took, and the eval
    // runner filters it on replay too — carrying it would misrepresent the case.
    context: messages
      .slice(0, inputIndex)
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        content: toPlainText(message.content),
        role: message.role ?? 'user',
      }))
      .filter((message) => message.content.trim().length > 0),
    input,
  };
};
