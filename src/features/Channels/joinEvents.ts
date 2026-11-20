import type { ChannelPublicMember, ChannelPublicMessage } from '@lobechat/types';

/** Members added by one action land within this window and read as one line. */
const BATCH_MS = 5000;

export interface ChannelJoinEvent {
  at: number;
  id: string;
  /**
   * The member who added them, from `ChannelPublicMember.invitedBy`. Absent when they joined on
   * their own, or joined before the adder was kept: the line then says who joined.
   */
  inviter?: ChannelPublicMember;
  members: ChannelPublicMember[];
}

const time = (value: Date | string) => new Date(value).getTime();

export const channelJoinEvents = (members: ChannelPublicMember[]): ChannelJoinEvent[] => {
  const byId = new Map(members.map((member) => [member.id, member]));
  const owner = members.find((member) => member.role === 'owner');
  const joined = members
    .filter((member) => member !== owner)
    .sort((a, b) => time(a.joinedAt) - time(b.joinedAt));
  const events: ChannelJoinEvent[] = [];
  for (const member of joined) {
    const at = time(member.joinedAt);
    const inviter = member.invitedBy ? byId.get(member.invitedBy) : undefined;
    const last = events.at(-1);
    if (last && at - last.at <= BATCH_MS && last.inviter === inviter) last.members.push(member);
    else events.push({ at, id: `join:${member.id}`, inviter, members: [member] });
  }
  return events;
};

export type TimelineItem =
  { event: ChannelJoinEvent; kind: 'event' } | { kind: 'message'; message: ChannelPublicMessage };

/**
 * Messages with join lines between them, by time. A page that does not reach the start of
 * the Channel only shows the joins inside its own time span.
 */
export const channelTimeline = (
  messages: ChannelPublicMessage[],
  events: ChannelJoinEvent[],
  fromStart: boolean,
): TimelineItem[] => {
  const first = messages[0] ? time(messages[0].createdAt) : undefined;
  const visible = events.filter((event) => fromStart || (first !== undefined && event.at >= first));
  const items: TimelineItem[] = [];
  let next = 0;
  for (const message of messages) {
    const at = time(message.createdAt);
    while (next < visible.length && visible[next].at <= at)
      items.push({ event: visible[next++], kind: 'event' });
    items.push({ kind: 'message', message });
  }
  while (next < visible.length) items.push({ event: visible[next++], kind: 'event' });
  return items;
};
