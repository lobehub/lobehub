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
  return {
    data,
    error,
    isConfirmed,
    isLoading: enabled && data === undefined && !error,
    revalidate,
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
