export interface RetainedUnreadTopicsState {
  ids: string[];
  indexObservedAt: number | undefined;
}

export const reconcileRetainedUnreadTopics = (
  current: RetainedUnreadTopicsState,
  ids: string[],
  indexObservedAt: number | undefined,
): RetainedUnreadTopicsState => {
  if (current.indexObservedAt !== indexObservedAt) return { ids, indexObservedAt };

  const retained = [...new Set([...current.ids, ...ids])];
  if (retained.length === current.ids.length) return current;
  return { ids: retained, indexObservedAt };
};

export const removeRetainedUnreadTopic = (
  current: RetainedUnreadTopicsState,
  topicId: string,
): RetainedUnreadTopicsState => {
  const ids = current.ids.filter((id) => id !== topicId);
  return ids.length === current.ids.length ? current : { ...current, ids };
};
