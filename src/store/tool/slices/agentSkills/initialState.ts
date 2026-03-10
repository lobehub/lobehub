import type { SkillItem, SkillListItem } from '@lobechat/types';

export interface AgentSkillsState {
  agentSkillDetailMap: Record<string, SkillItem>;
  agentSkills: SkillListItem[];
  agentSkillsLoading: boolean;
}

export const initialAgentSkillsState: AgentSkillsState = {
  agentSkillDetailMap: {},
  agentSkills: [],
  agentSkillsLoading: false,
};
