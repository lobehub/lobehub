import type { StepSkillDelta } from './types';

export interface BuildStepSkillDeltaParams {
  // Reserved for future step-level signals (e.g., @skill mentions)
}

/**
 * Build a declarative StepSkillDelta from runtime signals.
 *
 * Currently returns an empty delta — step-level skill activations
 * are accumulated in state.activatedStepSkills and passed directly
 * to SkillResolver. This function exists as the extension point for
 * future step-level signals (e.g., @skill mentions in user messages).
 */
export function buildStepSkillDelta(_params?: BuildStepSkillDeltaParams): StepSkillDelta {
  return { activatedSkills: [] };
}
