/**
 * Lightweight registry entry for an agent-document skill bundle (the "智能体
 * Skills" group, sourced from the `agent_document` table).
 *
 * Distinct from the user/market `SkillListItem` shape because these skills are
 * per-agent and don't carry a full `SkillManifest`. The slash menu, drag chip,
 * and runtime activation all key off `identifier` — the prefix lets the server
 * resolver tell them apart from builtin/DB skills.
 */
export interface AgentDocumentSkillItem {
  description?: string;
  documentId: string;
  /** `agent-document:<filename>` — matches the server-side runtime identifier. */
  identifier: string;
  /** Bundle filename (slug). */
  name: string;
  /** Human-readable display title; falls back to `name`. */
  title?: string;
}

export interface AgentDocumentSkillsState {
  /** Skills belonging to the currently-active agent; cleared on agent switch. */
  agentDocumentSkills: AgentDocumentSkillItem[];
  /** The agent id the current `agentDocumentSkills` snapshot belongs to. */
  agentDocumentSkillsAgentId: string | undefined;
}

export const initialAgentDocumentSkillsState: AgentDocumentSkillsState = {
  agentDocumentSkills: [],
  agentDocumentSkillsAgentId: undefined,
};
