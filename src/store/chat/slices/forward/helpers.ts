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

const blockText = (label: string, body: string) => `**${label}**\n\n${body.trim()}`;

export const buildForwardedContent = (
  messages: UIChatMessage[],
  options: ForwardContentOptions,
): string => {
  const blocks = getForwardableMessages(messages).map((message) => {
    const content =
      message.role === 'assistantGroup'
        ? message.children
            ?.map((child) => child.content?.trim())
            .filter(Boolean)
            .join('\n\n') || ''
        : message.content;
    const role = message.role === 'user' ? 'user' : 'assistant';

    return blockText(options.roleLabel(role), content);
  });

  return [options.header, ...blocks].join('\n\n---\n\n');
};
