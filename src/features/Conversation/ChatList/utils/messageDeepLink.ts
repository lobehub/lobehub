import type { AssistantContentBlock, ChatToolPayload, UIChatMessage } from '@lobechat/types';

export interface MessageDeepLink {
  id: string;
  navigationKey: string;
  onHandled?: () => void;
}

export interface ResolvedMessageDeepLink extends MessageDeepLink {
  displayMessageId: string;
  index: number;
}

const toolsContainMessage = (tools: ChatToolPayload[] | undefined, messageId: string) =>
  tools?.some((tool) => tool.result_msg_id === messageId) ?? false;

function assistantBlockContainsMessage(block: AssistantContentBlock, messageId: string): boolean {
  return (
    block.id === messageId ||
    toolsContainMessage(block.tools, messageId) ||
    block.council?.some((message) => messageContainsMessage(message, messageId)) === true
  );
}

function messageContainsMessage(message: UIChatMessage, messageId: string): boolean {
  return (
    message.id === messageId ||
    toolsContainMessage(message.tools, messageId) ||
    message.children?.some((block) => assistantBlockContainsMessage(block, messageId)) === true ||
    message.taskCompletions?.some((block) => assistantBlockContainsMessage(block, messageId)) ===
      true ||
    message.compressedMessages?.some((child) => messageContainsMessage(child, messageId)) ===
      true ||
    message.members?.some((member) => messageContainsMessage(member, messageId)) === true ||
    message.tasks?.some((task) => messageContainsMessage(task, messageId)) === true ||
    message.pinnedMessages?.some((pinned) => pinned.id === messageId) === true ||
    message.signalCallbacks?.some(
      (block) =>
        block.sourceToolMessageId === messageId ||
        block.callbacks.some((callback) => callback.id === messageId),
    ) === true
  );
}

/** Resolves a raw database message id to the virtual list row that renders it. */
export const resolveMessageDeepLink = (
  messages: UIChatMessage[],
  deepLink: MessageDeepLink | undefined,
): ResolvedMessageDeepLink | undefined => {
  if (!deepLink) return;

  const index = messages.findIndex((message) => messageContainsMessage(message, deepLink.id));
  if (index < 0) return;

  return {
    ...deepLink,
    displayMessageId: messages[index].id,
    index,
  };
};
