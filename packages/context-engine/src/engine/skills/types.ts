import type { SkillMeta } from '../../providers/SkillContextProvider';

/**
 * Application-layer checker that determines whether a skill is available
 * in the current environment (e.g., desktop-only skills on web).
 */
export type SkillEnableChecker = (skill: SkillMeta) => boolean;

/**
 * SkillEngine configuration options.
 */
export interface SkillEngineOptions {
  /** Optional checker to filter skills by environment/platform */
  enableChecker?: SkillEnableChecker;
  /** All raw skills from all sources (builtin, DB, etc.) */
  skills: SkillMeta[];
}

/**
 * Operation-level skill set: determined at createOperation time, immutable during execution.
 * Analogous to OperationToolSet for tools.
 */
export interface OperationSkillSet {
  /** Plugin IDs enabled on this agent — skills matching these IDs are auto-activated */
  enabledPluginIds: string[];
  /** All available skills after enableChecker filtering */
  skills: SkillMeta[];
}

/**
 * Record of a skill activated at step level (e.g., via activateSkill tool call).
 */
export interface ActivatedStepSkill {
  activatedAtStep: number;
  content?: string;
  identifier: string;
}

/**
 * Declarative delta describing skill changes for a single step.
 * Built by buildStepSkillDelta, consumed by SkillResolver.resolve.
 */
export interface StepSkillDelta {
  activatedSkills: Array<{
    content?: string;
    identifier: string;
  }>;
}

/**
 * Final resolved skill set ready for SkillContextProvider consumption.
 */
export interface ResolvedSkillSet {
  enabledSkills: SkillMeta[];
}
