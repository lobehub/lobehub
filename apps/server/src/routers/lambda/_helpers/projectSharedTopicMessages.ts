import {
  type AssistantContentBlock,
  ChatErrorType,
  type ChatMessageError,
  type UIChatMessage,
} from '@lobechat/types';

const projectError = (
  error: ChatMessageError | null | undefined,
): ChatMessageError | null | undefined => {
  if (!error) return error;

  const traceId = error.body?.traceId;

  return {
    ...(typeof traceId === 'string' ? { body: { traceId } } : {}),
    type: ChatErrorType.InternalServerError,
  };
};

const projectAssistantContentBlock = (block: AssistantContentBlock): AssistantContentBlock => ({
  ...block,
  council: block.council?.map(projectMessage),
  error: projectError(block.error),
  tools: block.tools?.map((tool) => ({
    ...tool,
    result: tool.result ? { ...tool.result, error: undefined } : undefined,
  })),
});

const projectMessage = (message: UIChatMessage): UIChatMessage => ({
  ...message,
  children: message.children?.map(projectAssistantContentBlock),
  ...(message.columns && { columns: message.columns.map((column) => column.map(projectMessage)) }),
  compressedMessages: message.compressedMessages?.map(projectMessage),
  error: projectError(message.error),
  members: message.members?.map(projectMessage),
  pluginError: undefined,
  taskCompletions: message.taskCompletions?.map(projectAssistantContentBlock),
  tasks: message.tasks?.map(projectMessage),
});

/** Preserve shared content while projecting stored diagnostics into visitor-safe errors. */
export const projectSharedTopicMessages = (messages: UIChatMessage[]): UIChatMessage[] =>
  messages.map(projectMessage);
