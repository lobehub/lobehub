export const resolveConversationMode = (agentShareId?: string) => {
  const readOnly = Boolean(agentShareId);

  return { readOnly, showComposer: !readOnly };
};
