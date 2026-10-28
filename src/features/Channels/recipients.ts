import type { ChannelMemberActorType } from '@lobechat/types';

export interface ComposerMember {
  actorType: ChannelMemberActorType;
  /** Seeds the generated avatar of an Agent without one of its own. */
  agentId?: string | null;
  avatar: string;
  id: string;
  name: string;
}

/**
 * - `automatic`: the decision model selects from the eligible Agents.
 * - `all`: routing is off and no Agent is mentioned, so every eligible Agent replies.
 * - `named`: the mentioned Agents, or the Thread's followers.
 * - `peopleOnly`: only people are mentioned, which wakes no Agent.
 * - `noFollowers`: a Thread nobody follows yet; a mention invites an Agent.
 * - `noAgents`: the main conversation has no active Agent.
 */
export type ComposerRecipientKind =
  'automatic' | 'all' | 'named' | 'noAgents' | 'noFollowers' | 'peopleOnly';

/**
 * Who replies if the draft is sent now. Mirrors `sendMessage` in the Channel repository:
 * mentioned Agents when anyone is mentioned, otherwise the default recipients (every active
 * Agent on the main conversation, the followers inside a Thread).
 */
export const composerRecipients = ({
  defaultRecipientIds,
  decisionEnabled = false,
  inThread,
  members,
  mentionIds,
}: {
  defaultRecipientIds: string[];
  decisionEnabled?: boolean;
  inThread: boolean;
  members: ComposerMember[];
  mentionIds: string[];
}): { agents: ComposerMember[]; kind: ComposerRecipientKind } => {
  const agents = members.filter((member) => member.actorType === 'agent');
  if (mentionIds.length) {
    // In the order they were mentioned, so the preview names who the user typed first.
    const mentioned = mentionIds.flatMap((id) => agents.filter((agent) => agent.id === id));
    return { agents: mentioned, kind: mentioned.length ? 'named' : 'peopleOnly' };
  }
  const defaults = agents.filter((agent) => defaultRecipientIds.includes(agent.id));
  if (!defaults.length) return { agents: [], kind: inThread ? 'noFollowers' : 'noAgents' };
  if (decisionEnabled) return { agents: [], kind: 'automatic' };
  return { agents: defaults, kind: !inThread && defaults.length > 1 ? 'all' : 'named' };
};
