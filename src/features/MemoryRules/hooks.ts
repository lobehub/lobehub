import { expertiseActions, expertiseSelectors, useExpertiseStore } from '@/store/expertise';

/**
 * The reviewer's own rules by group, plus the backlog of rejected rounds nothing has read yet.
 * Painted from the local replica on reload and revalidated in the background; `isConfirmed`
 * says whether the server has answered yet, so an empty restored sheet is not onboarding.
 */
export const useRules = (enabled = true) => {
  const { error, revalidate } = expertiseActions.useFetchRules(enabled);
  const data = useExpertiseStore(expertiseSelectors.rules);
  const isConfirmed = useExpertiseStore(expertiseSelectors.isRulesConfirmed);
  // What the page may treat as settled: a restored sheet with no groups is last session's copy,
  // not "you have no rules", so it stays loading (or shows the error) until the server answers.
  const settled = isConfirmed || !!data?.groups.length ? data : undefined;
  return {
    data,
    error,
    isConfirmed,
    isLoading: enabled && settled === undefined && !error,
    revalidate,
    settled,
  };
};

export const useRuleSources = (lessonId?: string) => {
  const { error, revalidate } = expertiseActions.useFetchRuleSources(lessonId);
  const data = useExpertiseStore(expertiseSelectors.ruleSources(lessonId));
  const isConfirmed = useExpertiseStore(expertiseSelectors.isRuleSourcesConfirmed(lessonId));
  return { data, error, isConfirmed, isLoading: !!lessonId && !isConfirmed && !error, revalidate };
};

export const useRuleRevisions = (lessonId?: string) => {
  const { error } = expertiseActions.useFetchRuleRevisions(lessonId);
  const data = useExpertiseStore(expertiseSelectors.ruleRevisions(lessonId));
  return { data, error };
};
