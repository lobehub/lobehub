import { useClientDataSWR } from '@/libs/swr';
import { swrKeys } from '@/libs/swr/keys';
import { expertiseService } from '@/services/expertise';

/** The reviewer's own rules by group, plus the backlog of rejected rounds nothing has read yet. */
export const useRules = () =>
  useClientDataSWR(swrKeys.expertise.rules(), () => expertiseService.listRules());

export const useRuleSources = (lessonId?: string) =>
  useClientDataSWR(lessonId ? swrKeys.expertise.ruleSources(lessonId) : null, () =>
    expertiseService.ruleSources(lessonId!),
  );

export const useRuleRevisions = (lessonId?: string) =>
  useClientDataSWR(lessonId ? swrKeys.expertise.ruleRevisions(lessonId) : null, () =>
    expertiseService.ruleRevisions(lessonId!),
  );
