import type { AssistantContentBlock, MessageSignal } from '@lobechat/types';

export interface TaskCompletionSource {
  /** The source call's `description` argument, e.g. a subagent's task title. */
  description?: string;
  /** API name of the tool whose completion woke the turn, e.g. `Agent`. */
  toolName: string;
}

const readDescription = (args?: string): string | undefined => {
  if (!args) return;
  try {
    const description = JSON.parse(args)?.description;
    return typeof description === 'string' && description.trim() ? description.trim() : undefined;
  } catch {
    return;
  }
};

/**
 * The long-running tool (a background subagent, Bash, Monitor…) whose
 * completion woke a task-completion turn, looked up among the reply's own
 * tool calls so the notice can name it. Undefined for any other block.
 */
export const resolveTaskCompletionSource = (
  block: AssistantContentBlock,
  replyBlocks: AssistantContentBlock[],
): TaskCompletionSource | undefined => {
  const signal = block.metadata?.signal as MessageSignal | undefined;
  if (signal?.type !== 'task-completion') return;

  const sourceCall = replyBlocks
    .flatMap((replyBlock) => replyBlock.tools ?? [])
    .find((tool) => tool.id === signal.sourceToolCallId);

  return {
    description: readDescription(sourceCall?.arguments),
    toolName: sourceCall?.apiName ?? signal.sourceToolName,
  };
};
