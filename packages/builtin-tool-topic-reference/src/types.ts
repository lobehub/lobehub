export const TopicReferenceIdentifier = 'lobe-topic-reference';

export const TopicReferenceApiName = {
  getTopicContext: 'getTopicContext',
} as const;

export type TopicReferenceApiNameType =
  (typeof TopicReferenceApiName)[keyof typeof TopicReferenceApiName];
