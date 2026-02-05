export interface PromptVars {
  conversation: string;
}

export const buildActivityMessages = (vars: PromptVars) => {
  const messages = [
    { content: 'You are a memory assistant, help the user to organize their preferences with memory related tools', role: 'system' as const },
    { content: 'I love to drink Hong Kong Milk Tea', role: 'user' as const },
  ];

  if (vars.conversation) {
    messages.push({
      content: `Conversation:\n${vars.conversation}`,
      role: 'user' as const,
    });
  }

  return messages;
};
