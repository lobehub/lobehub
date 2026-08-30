interface TopicIdentity {
  id: string;
}

interface HomeTopicSections<TRecent extends TopicIdentity, TRunning extends TopicIdentity> {
  recent: TRecent[];
  running: TRunning[];
}

export interface HomeTopicIdSections {
  recent: string[];
  running: string[];
}

/**
 * Running topics are a live status group, not a subtype of recency. Keep the
 * sections mutually exclusive while preserving the source order of both feeds.
 */
export const resolveHomeTopicSections = <
  TRecent extends TopicIdentity,
  TRunning extends TopicIdentity,
>(
  recentTopics: readonly TRecent[],
  runningTopics: readonly TRunning[],
): HomeTopicSections<TRecent, TRunning> => {
  const runningTopicIds = new Set(runningTopics.map((topic) => topic.id));

  return {
    recent: recentTopics.filter((topic) => !runningTopicIds.has(topic.id)),
    running: [...runningTopics],
  };
};

export const resolveHomeTopicIdSections = (
  recentTopicIds: readonly string[],
  runningTopicIds: readonly string[],
): HomeTopicIdSections => {
  const runningIds = new Set(runningTopicIds);

  return {
    recent: recentTopicIds.filter((id) => !runningIds.has(id)),
    running: [...runningTopicIds],
  };
};
