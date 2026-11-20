import type { ToolStoreState } from '../../initialState';
import type { AgentDocumentSkillItem } from './projection';

const EMPTY_AGENT_DOCUMENT_SKILLS: AgentDocumentSkillItem[] = [];

/** The agent's skill bundles as its replica entry holds them. */
const getAgentDocumentSkills =
  (agentId: string | undefined) =>
  (s: ToolStoreState): AgentDocumentSkillItem[] =>
    (agentId ? s.agentDocumentSkillsMap[agentId] : undefined) ?? EMPTY_AGENT_DOCUMENT_SKILLS;

const getAgentDocumentSkillByIdentifier =
  (agentId: string | undefined, identifier: string) =>
  (s: ToolStoreState): AgentDocumentSkillItem | undefined =>
    getAgentDocumentSkills(agentId)(s).find((skill) => skill.identifier === identifier);

export const agentDocumentSkillsSelectors = {
  getAgentDocumentSkillByIdentifier,
  getAgentDocumentSkills,
};
