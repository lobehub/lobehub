import type { UIChatMessage } from '@lobechat/types';

export interface ForwardContentOptions {
  header: string;
  roleLabel: (role: 'assistant' | 'user') => string;
}

export const getForwardableMessages = (messages: UIChatMessage[]): UIChatMessage[] =>
  messages.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') && !!message.content?.trim(),
  );

const blockText = (label: string, body: string) => `**${label}**\n\n${body.trim()}`;

export const buildForwardedContent = (
  messages: UIChatMessage[],
  options: ForwardContentOptions,
): string => {
  const blocks = getForwardableMessages(messages).map((message) =>
    blockText(options.roleLabel(message.role as 'assistant' | 'user'), message.content),
  );

  return [options.header, ...blocks].join('\n\n---\n\n');
};
