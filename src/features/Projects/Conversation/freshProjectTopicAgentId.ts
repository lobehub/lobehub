/**
 * The owning agent of a topic the route points at that the project list doesn't
 * have yet, but the chat store does: the first send of a blank project
 * conversation moves the route before the list catches up. Undefined for
 * anything else — another project's cached topic must still read as not found.
 *
 * The owner comes from the topic row (`sessionId`), never the globally focused
 * agent: another pane may change that while this one waits for the list, and
 * this pane would then load — and write back — the wrong agent. Only the
 * optimistic row carries `sessionId` (server list rows strip it), so once a
 * refresh replaces that row the caller passes back the owner it remembered.
 */
export const freshProjectTopicAgentId = (params: {
  listed: boolean;
  projectId: string | undefined;
  rememberedOwner?: { agentId: string; topicId: string };
  storedTopic: { projectId?: string | null; sessionId?: string | null } | undefined;
  topicId: string | undefined;
}): string | undefined => {
  const { listed, projectId, rememberedOwner, storedTopic, topicId } = params;
  if (!topicId || listed || !storedTopic?.projectId || storedTopic.projectId !== projectId)
    return undefined;

  return (
    storedTopic.sessionId ??
    (rememberedOwner?.topicId === topicId ? rememberedOwner.agentId : undefined)
  );
};
