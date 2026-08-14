import type { GoalCriterionDraft } from '@lobechat/builtin-tool-task';

import type { VerifyCriterionDraft } from '@/services/verify';
import { verifyService } from '@/services/verify';

interface GenerateGoalCriteriaParams {
  context?: string;
  goal: string;
  model: string;
  provider: string;
}

export const withGoalCriterionDefaults = (draft: VerifyCriterionDraft): GoalCriterionDraft => ({
  ...draft,
  onFail: draft.onFail ?? 'auto_repair',
  required: draft.required ?? true,
  verifierType: draft.verifierType ?? 'agent',
});

export const createFallbackGoalCriterion = (goal: string): GoalCriterionDraft => ({
  onFail: 'auto_repair',
  required: true,
  title: goal,
  verifierType: 'agent',
});

export const generateGoalCriteria = async ({
  context,
  goal,
  model,
  provider,
}: GenerateGoalCriteriaParams): Promise<GoalCriterionDraft[]> => {
  const generated = await verifyService.generateCriteria({
    context,
    goal,
    maxCriteria: 8,
    modelConfig: { model, provider },
  });

  if (generated.length === 0) throw new Error('No acceptance criteria were generated.');

  return generated.map(withGoalCriterionDefaults);
};
