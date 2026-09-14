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

const projectBlock = (block: AssistantContentBlock): AssistantContentBlock => ({
  ...block,
  council: block.council?.map(projectMessage),
  error: projectError(block.error),
  tasks: block.tasks?.map((task) => ({ ...task, error: undefined })),
  tools: block.tools?.map((tool) => ({
    ...tool,
    result: tool.result ? { ...tool.result, error: undefined } : undefined,
  })),
});

const projectMessage = (message: UIChatMessage): UIChatMessage => ({
  ...message,
  children: message.children?.map(projectBlock),
  compressedMessages: message.compressedMessages?.map(projectMessage),
  error: projectError(message.error),
  members: message.members?.map(projectMessage),
  pluginError: undefined,
  taskCompletions: message.taskCompletions?.map(projectBlock),
  taskDetail: message.taskDetail ? { ...message.taskDetail, error: undefined } : undefined,
  tasks: message.tasks?.map(projectMessage),
});

/** Preserve shared content while projecting stored diagnostics into visitor-safe errors. */
export const projectSharedTopicMessages = (messages: UIChatMessage[]): UIChatMessage[] =>
  messages.map(projectMessage);
