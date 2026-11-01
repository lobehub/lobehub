import type { AgentGroupConfig } from '@lobechat/context-engine';
import { agentIdentityLabel } from '@lobechat/types';

/**
 * Format error for storage in thread metadata
 * Handles Error objects which don't serialize properly with JSON.stringify
 */
export function formatErrorForMetadata(error: unknown): Record<string, any> | undefined {
  if (!error) return undefined;

  // Handle Error objects
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  // Handle objects with message property (like ChatMessageError)
  if (typeof error === 'object' && 'message' in error) {
    return error as Record<string, any>;
  }

  // Fallback: wrap in object
  return { message: String(error) };
}

/**
 * Build the multi-agent group context from a group's member roster, mirroring
 * the client `contextEngineering.ts` `agentGroup` build. Carries every member's
 * real `agt_*` ID so the supervisor dispatches members by ID instead of role
 * name (role names don't resolve → "Agent member(s) failed to start."). Resolves
 * the responding agent's own role/name so GroupContextInjector marks it with
 * `you="true"` and the orchestration filter activates for participants.
 */
export const buildGroupAgentContext = (
  currentAgentId: string,
  group: { content?: string | null; title?: string | null } | undefined,
  roster: Array<{
    agentId: string;
    name?: string | null;
    role: string | null;
    title: string | null;
  }>,
): AgentGroupConfig | undefined => {
  if (roster.length === 0) return undefined;

  const agentMap: AgentGroupConfig['agentMap'] = {};
  const members: NonNullable<AgentGroupConfig['members']> = [];
  let currentAgentName: string | undefined;
  let currentAgentRole: 'supervisor' | 'participant' | undefined;

  for (const member of roster) {
    const role = member.role === 'supervisor' ? 'supervisor' : 'participant';
    // "Nasa (Shadow Arvin)": the name people call it by, and its role.
    const name = agentIdentityLabel(member, 'Untitled Agent');
    agentMap[member.agentId] = { name, role };
    members.push({ id: member.agentId, name, role });

    if (member.agentId === currentAgentId) {
      currentAgentName = name;
      currentAgentRole = role;
    }
  }

  return {
    agentMap,
    currentAgentId,
    currentAgentName,
    currentAgentRole,
    groupTitle: group?.title || undefined,
    members,
    systemPrompt: group?.content || undefined,
  };
};

/**
 * Bot-conversation fallback: a single bot agent has no real group, so build a
 * degenerate one-member context purely to give it its `<group_context>`
 * identity block. Only used when there is no `groupId`.
 */
export const buildBotConversationGroupContext = (
  currentAgentId: string,
  agentConfig: { description?: unknown; name?: unknown; title?: unknown } | undefined,
): AgentGroupConfig => {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const description = agentConfig?.description;
  // This block replaces `<agent_identity>` (suppressed whenever a group context is set), so it must
  // carry the agent's name, not only its title: people call the bot by its name.
  const name = agentIdentityLabel(
    { name: text(agentConfig?.name), title: text(agentConfig?.title) },
    'Current Agent',
  );

  return {
    agentMap: { [currentAgentId]: { name, role: 'participant' } },
    currentAgentId,
    currentAgentName: name,
    currentAgentRole: 'participant',
    members: [{ id: currentAgentId, name, role: 'participant' }],
    systemPrompt: typeof description === 'string' ? description : undefined,
  };
};
