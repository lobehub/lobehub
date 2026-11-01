import type { GoalCriterionDraft } from '@lobechat/builtin-tool-task';

import type { VerifyCriterionDraft } from '@/services/verify';
import { verifyService } from '@/services/verify';

interface GenerateGoalCriteriaParams {
  context?: string;
  goal: string;
}

export interface GeneratedGoalPlan {
  criteria: GoalCriterionDraft[];
  instruction: string;
  title: string;
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
}: GenerateGoalCriteriaParams): Promise<GeneratedGoalPlan> => {
  const generated = await verifyService.generateGoalPlan({
    context,
    goal,
    maxCriteria: 8,
  });

  if (!generated || generated.criteria.length === 0) throw new Error('No goal plan was generated.');

  return {
    ...generated,
    criteria: generated.criteria.map(withGoalCriterionDefaults),
    instruction: generated.instruction.trim() || goal.trim(),
  };
};
