// Fixture: a service deferring a sibling module with await import().
export const summarizeTopic = async (topicId: string) => {
  // alint-expect
  const { TopicSummaryService } = await import('./TopicSummaryService');
  return new TopicSummaryService().run(topicId);
};
