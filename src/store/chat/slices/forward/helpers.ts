import type { UIChatMessage } from '@lobechat/types';

export interface ForwardContentOptions {
  header: string;
  roleLabel: (role: 'assistant' | 'user') => string;
}

export const getForwardableMessages = (messages: UIChatMessage[]): UIChatMessage[] =>
  messages.filter(
    (message) =>
      ((message.role === 'user' || message.role === 'assistant') && !!message.content?.trim()) ||
      (message.role === 'assistantGroup' &&
        !!message.children?.some((child) => !!child.content?.trim())),
  );

export const getForwardedMessageText = (message: UIChatMessage): string =>
  message.role === 'assistantGroup'
    ? message.children
        ?.map((child) => child.content?.trim())
        .filter(Boolean)
        .join('\n\n') || ''
    : message.content;

const blockText = (label: string, body: string) => `**${label}**\n\n${body.trim()}`;

export const buildForwardedContent = (
  messages: UIChatMessage[],
  options: ForwardContentOptions,
): string => {
  const blocks = getForwardableMessages(messages).map((message) => {
    const role = message.role === 'user' ? 'user' : 'assistant';

    return blockText(options.roleLabel(role), getForwardedMessageText(message));
  });

  return [options.header, ...blocks].join('\n\n---\n\n');
};
