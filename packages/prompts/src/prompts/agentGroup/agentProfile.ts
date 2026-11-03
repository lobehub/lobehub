/**
 * Agent Profile Formatting
 *
 * Utility for formatting agent information into human-readable profile text.
 * Used by getAgentInfo tool to return agent details to supervisor.
 */

export interface AgentProfileInfo {
  avatar?: string | null;
  description?: string | null;
  id: string;
  model?: string | null;
  provider?: string | null;
  systemRole?: string | null;
  title?: string | null;
}

/**
 * Agent profile template
 *
 * Variables:
 * - {{title}} - Agent's display name
 * - {{id}} - Agent's ID
 * - {{description}} - Agent's description
 * - {{model}} - Model used by agent
 * - {{systemRole}} - Agent's system role (truncated if > 500 chars)
 */
const AGENT_PROFILE_TEMPLATE = `# Agent: {{title}}

- **ID**: {{id}}
- **Description**: {{description}}
- **Model**: {{model}}

## System Role

{{systemRole}}`;

/**
 * Format agent information into a human-readable profile text
 * Used by getAgentInfo tool to return agent details to supervisor
 */
export const formatAgentProfile = (agent: AgentProfileInfo): string => {
  const systemRole =
    agent.systemRole && agent.systemRole.length > 500
      ? agent.systemRole.slice(0, 500) + '... (truncated)'
      : agent.systemRole;

  return AGENT_PROFILE_TEMPLATE.replace('{{title}}', agent.title || 'Untitled Agent')
    .replace('{{id}}', agent.id)
    .replace('{{description}}', agent.description || 'N/A')
    .replace('{{model}}', agent.model || 'Unknown Model')
    .replace('{{systemRole}}', systemRole || 'N/A');
};
