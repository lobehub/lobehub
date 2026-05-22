import type { ToolStoreState } from '../../initialState';
import type { AgentDocumentSkillItem } from './initialState';

const getAgentDocumentSkills = (s: ToolStoreState): AgentDocumentSkillItem[] =>
  s.agentDocumentSkills || [];

const getAgentDocumentSkillByIdentifier =
  (identifier: string) =>
  (s: ToolStoreState): AgentDocumentSkillItem | undefined =>
    (s.agentDocumentSkills || []).find((skill) => skill.identifier === identifier);

export const agentDocumentSkillsSelectors = {
  getAgentDocumentSkillByIdentifier,
  getAgentDocumentSkills,
};
