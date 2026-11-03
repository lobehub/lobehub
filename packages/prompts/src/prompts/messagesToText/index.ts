export interface Message {
  content: string;
  role: string;
}

/**
 * Convert conversation messages to XML-formatted text
 * @param messages - Array of message objects with role and content
 * @returns Formatted conversation text wrapped in chat_history tags
 */
export function conversationToText(messages: Message[]): string {
  return messages.length === 0
    ? `<conversation/>`
    : `<conversation>
${messages.map((m) => `<${m.role}>${m.content}</${m.role}>`).join('\n')}
</conversation>`;
}
