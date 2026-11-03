/**
 * Context for Group Supervisor agent
 */
export interface GroupSupervisorContext {
  /** Available agents in the group */
  availableAgents: Array<{ id: string; title?: string | null }>;
  /** Group ID */
  groupId: string;
  /** Group title/name */
  groupTitle: string;
  /** Custom system prompt for the supervisor */
  systemPrompt?: string;
}
