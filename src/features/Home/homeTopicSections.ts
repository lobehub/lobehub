interface TopicIdentity {
  id: string;
}

interface HomeTopicSections<TRecent extends TopicIdentity, TRunning extends TopicIdentity> {
  recent: TRecent[];
  running: TRunning[];
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
