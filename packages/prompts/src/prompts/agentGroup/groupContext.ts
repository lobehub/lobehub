/**
 * Group Context Template
 *
 * Template for injecting group context into participant agents' system role.
 * Used by GroupContextInjector in context-engine.
 *
 * Format follows the same structure as group-supervisor systemRole.
 */

/**
 * Group member info for context injection
 */
export interface GroupContextMemberInfo {
  id: string;
  name: string;
  role: 'supervisor' | 'participant';
}

export const groupContextTemplate = `You are "{{AGENT_NAME}}", acting as a {{AGENT_ROLE}} in the multi-agent group "{{GROUP_TITLE}}".
Your internal agent ID is {{AGENT_ID}} (for system use only, never expose to users).

<critical_output_rules>
IMPORTANT: Your responses must contain ONLY your actual reply content.
- Messages in conversation history start with '<speaker name="..." />' - this identifies who sent each message
- NEVER start your response with '<speaker' tag - the system adds this automatically
- Just output your actual response content directly
</critical_output_rules>

<group_description>The following describes the purpose and goals of this agent group:

{{SYSTEM_PROMPT}}
</group_description>

<group_participants>The following agents are available in this group:

{{GROUP_MEMBERS}}
</group_participants>

<identity_rules>
- NEVER expose or display agent IDs to users - always refer to agents by their names
</identity_rules>`;

/**
 * Agent info for group supervisor context
 */
export interface GroupSupervisorAgentInfo {
  id: string;
  title?: string | null;
}

/**
 * Build group members XML for group-supervisor systemRole
 *
 * @param agents - List of available agents in the group
 * @returns Formatted XML string for {{GROUP_MEMBERS}} placeholder
 *
 * @example
 * ```typescript
 * const agents = [
 *   { id: 'agt_xxx', title: '创意总监' },
 *   { id: 'agt_yyy', title: '设计师' },
 * ];
 * const xml = buildGroupMembersXml(agents);
 * // Returns:
 * //   <member name="创意总监" id="agt_xxx" />
 * //   <member name="设计师" id="agt_yyy" />
 * ```
 */
export const buildGroupMembersXml = (agents: GroupSupervisorAgentInfo[]): string => {
  return agents
    .map((agent) => `  <member name="${agent.title || agent.id}" id="${agent.id}" />`)
    .join('\n');
};

/**
 * Format group members list for {{GROUP_MEMBERS}} placeholder replacement
 * Uses XML format consistent with group-supervisor systemRole
 *
 * @param members - List of group members
 * @param currentAgentId - Current agent's ID (will be marked with "you" attribute)
 * @returns Formatted members string in XML format for template replacement
 *
 * @example
 * ```typescript
 * const members = [
 *   { id: 'agt_supervisor', name: 'Supervisor', role: 'supervisor' },
 *   { id: 'agt_editor', name: 'Editor', role: 'participant' },
 * ];
 * const formatted = formatGroupMembers(members, 'agt_editor');
 * // Returns:
 * //   <member name="Supervisor" id="agt_supervisor" />
 * //   <member name="Editor" id="agt_editor" you="true" />
 * ```
 */
export const formatGroupMembers = (
  members: GroupContextMemberInfo[],
  currentAgentId?: string,
): string => {
  return members
    .map((m) => {
      const youAttr = m.id === currentAgentId ? ' you="true"' : '';
      return `  <member name="${m.name}" id="${m.id}"${youAttr} />`;
    })
    .join('\n');
};
