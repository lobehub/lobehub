export const LobeActivatorIdentifier = 'lobe-activator';

export const ActivatorApiName = {
  activateSkill: 'activateSkill',
  activateTools: 'activateTools',
};

export interface ActivateToolsParams {
  identifiers: string[];
  reason: string;
}

export interface ActivatedToolInfo {
  apiCount: number;
  avatar?: string;
  identifier: string;
  name: string;
}

export interface UnavailableToolInfo {
  identifier: string;
  /** Why the host withholds the tool from this run, in words for the model. */
  reason: string;
}

export interface ActivateSkillParams {
  name: string;
}

export type ActivateSkillSource = 'agent' | 'builtin' | 'device' | 'project' | 'user';

export interface ActivateSkillState {
  description?: string;
  hasResources: boolean;
  id: string;
  name: string;
  /** Skill origin — drives the inspector label (e.g. "Activate Agent Skill"). */
  source?: ActivateSkillSource;
  /** Friendly title for UI display; falls back to `name` when unset. */
  title?: string;
}

export interface ActivateToolsState {
  /** Skills opened because a requested identifier named a skill, not a tool. */
  activatedSkills?: ActivateSkillState[];
  activatedTools: ActivatedToolInfo[];
  alreadyActive: string[];
  /**
   * The entries of `notFound` the host could explain. The result text is
   * rebuilt from this state once the activated docs move to the system prompt,
   * so a reason kept only in the text would not survive that rewrite.
   */
  notAvailable?: UnavailableToolInfo[];
  /** Every requested identifier that was not activated, explained or not. */
  notFound: string[];
}
