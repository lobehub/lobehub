import type { ChannelMemberConfig } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import type { ChannelItem } from '../../schemas';
import { agents, channelMembers, channels } from '../../schemas';
import type { Transaction } from '../../type';
import { memberEnvironment, requireAgentMember } from './agent';
import { audit } from './transaction';

/** An environment plus the member's own settings that live beside it: reply strategy and mute. */
export const withMemberWake = (
  config: ChannelMemberConfig,
  wake: Record<string, unknown> | null | undefined,
  muted: boolean | undefined,
): ChannelMemberConfig => ({ ...config, ...(wake && { wake }), ...(muted && { muted }) });

/** The channel's reply strategy and each active Agent member's own, as stored. */
export const readWakeConfig = async (tx: Transaction, channel: ChannelItem) => {
  const members = await tx
    .select({ config: channelMembers.config, id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channel.id),
        eq(channelMembers.actorType, 'agent'),
        eq(channelMembers.status, 'active'),
      ),
    );
  return {
    channel: channel.config?.wake ?? null,
    members: members.map((member) => ({
      memberId: member.id,
      wake: member.config?.wake ?? null,
    })),
  };
};

/** Whose records one Agent member's wake decisions are filed under; see `memberWakeRecordScope`. */
export const wakeRecordScope = async (tx: Transaction, channel: ChannelItem, memberId: string) => {
  const member = await requireAgentMember(tx, channel.id, memberId);
  const [agent] = await tx
    .select({ userId: agents.userId })
    .from(agents)
    .where(eq(agents.id, member.agentId));
  return agent?.userId ? { userId: agent.userId, workspaceId: channel.workspaceId } : null;
};

/** Replaces the channel's reply strategy; `null` returns it to the defaults. */
export const replaceChannelWake = async (
  tx: Transaction,
  channel: ChannelItem,
  wake: Record<string, unknown> | null,
) => {
  const { wake: _previous, ...rest } = channel.config ?? {};
  const config = wake ? { ...rest, wake } : rest;
  const [updated] = await tx
    .update(channels)
    .set({ config: Object.keys(config).length ? config : null })
    .where(eq(channels.id, channel.id))
    .returning();
  await audit(tx, channel.id, 'wake_config_changed', channel.id, { reset: !wake });
  return updated.config?.wake ?? null;
};

/** Replaces one Agent member's own reply strategy; its environment and mute are kept. */
export const replaceMemberWake = async (
  tx: Transaction,
  channelId: string,
  memberId: string,
  wake: Record<string, unknown> | null,
) => {
  const current = await requireAgentMember(tx, channelId, memberId);
  const [member] = await tx
    .update(channelMembers)
    .set({
      config: withMemberWake(memberEnvironment(current.config), wake, current.config?.muted),
    })
    .where(eq(channelMembers.id, memberId))
    .returning();
  await audit(tx, channelId, 'member_wake_config_changed', memberId, { reset: !wake });
  return member.config?.wake ?? null;
};
