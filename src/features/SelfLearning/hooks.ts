import { expertiseActions, expertiseSelectors, useExpertiseStore } from '@/store/expertise';

/**
 * The portrait query, painted from the local replica and revalidated in the background.
 * `refreshInterval` is only set while a history warm-up is running so newly learned habits
 * stream in without a manual reload. `isConfirmed` says whether the server has answered, so a
 * restored empty portrait is not taken for "no directions yet".
 */
export const useExpertiseOverview = (agentId?: string, refreshInterval?: number) => {
  const { error, revalidate } = expertiseActions.useFetchOverview(agentId, refreshInterval);
  const data = useExpertiseStore(expertiseSelectors.overview(agentId));
  const isConfirmed = useExpertiseStore(expertiseSelectors.isOverviewConfirmed(agentId));
  return {
    data,
    error,
    isConfirmed,
    isLoading: !!agentId && data === undefined && !error,
    revalidate,
  };
};

export const useExpertiseDomain = (domainId?: string) => {
  const { error, revalidate } = expertiseActions.useFetchDomain(domainId);
  const data = useExpertiseStore(expertiseSelectors.domain(domainId));
  return { data, error, revalidate };
};

/**
 * One lesson. `notFound` is only true once the server answered that it is gone; until then a
 * missing entry is still loading.
 */
export const useExpertiseLesson = (lessonId?: string) => {
  const { error, revalidate } = expertiseActions.useFetchLesson(lessonId);
  const data = useExpertiseStore(expertiseSelectors.lesson(lessonId));
  const notFound = useExpertiseStore(expertiseSelectors.isLessonNotFound(lessonId));
  return {
    data,
    error,
    isLoading: !!lessonId && data === undefined && !notFound && !error,
    notFound,
    revalidate,
  };
};

export const useHistoryCount = (agentId?: string) => {
  const { error } = expertiseActions.useFetchHistoryCount(agentId);
  const data = useExpertiseStore(expertiseSelectors.historyCount(agentId));
  return { data, error };
};
