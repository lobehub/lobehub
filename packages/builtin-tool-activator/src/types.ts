import type { OnDemandCapabilityExpectation, OnDemandCapabilitySource } from '@lobechat/types';

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
  /** Exact bundle identity persisted for the next resolver step. */
  capability?: OnDemandCapabilityExpectation;
  capabilitySummary?: string;
  executionEnvironment?: 'client' | 'device' | 'sandbox' | 'server';
  hash?: string;
  identifier: string;
  name: string;
  source?: OnDemandCapabilitySource;
  version?: string;
}

export interface ActivateToolsState {
  activatedTools: ActivatedToolInfo[];
  alreadyActive: string[];
  notFound: string[];
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
