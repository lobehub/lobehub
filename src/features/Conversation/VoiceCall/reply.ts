interface VoiceMessage {
  content?: string;
  error?: unknown;
  id: string;
  parentId?: string | null;
  role: string;
  tools?: unknown[] | null;
}

/** Speak only the final assistant reply descended from this voice turn. */
export const getVoiceReply = (messages: VoiceMessage[], userMessageId: string): string => {
  const descendants = new Set([userMessageId]);
  // Tool/sub-agent rows may arrive out of order while the transcript rehydrates.
  for (let changed = true; changed;) {
    changed = false;
    for (const message of messages) {
      if (message.parentId && descendants.has(message.parentId) && !descendants.has(message.id)) {
        descendants.add(message.id);
        changed = true;
      }
    }
  }
  const reply = messages.findLast(
    (message) =>
      descendants.has(message.id) &&
      message.role === 'assistant' &&
      !message.error &&
      !message.tools?.length &&
      Boolean(message.content?.trim()),
  );
  if (!reply?.content)
    throw new Error(
      'The agent did not return a spoken reply. Check the conversation for errors or approvals.',
    );
  return reply.content;
};
