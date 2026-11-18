const AGENT_ID_PREFIX = 'agt_';

/**
 * Whether a mention points at an Agent. The chat composer stamps `type: 'agent'`;
 * group-chat members and older messages only carry the id, and Agent ids are
 * the ones with the `agt_` prefix.
 */
export const isAgentMention = (id?: string | null, type?: string | null) =>
  type === 'agent' || !!id?.startsWith(AGENT_ID_PREFIX);
