/** Narrow the workspace-wide inbox feed to the viewer's own rows, private conversations included. */
export const filterMyInboxTopics = <T extends { userId?: string }>(
  topics: readonly T[],
  myId: string | undefined,
): T[] => topics.filter((topic) => topic.userId === myId);
