// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, channelMessageReactions, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelHistoryRepository, ChannelRepository } from '..';
import {
  CHANNEL_REACTION_EMOJI_PER_MESSAGE,
  CHANNEL_REACTIONS_PER_MEMBER,
  frequentReactions,
  normalizeReactionEmoji,
  REACTION_MEMBER_PREVIEW,
  setReaction,
} from '../reactions';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-reactions');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { role: 'owner', userId: fixture.ownerId, workspaceId: fixture.workspaceId },
    { userId: fixture.memberId, workspaceId: fixture.workspaceId },
  ]);
});
afterEach(fixture.cleanup);

/** What the router does for a person: their own member, under the Channel lock. */
const toggle = (as: ChannelRepository, channelId: string, messageId: string, emoji: string) =>
  as.write(channelId, (tx, { member }) => setReaction(tx, channelId, member.id, messageId, emoji));

const setup = async () => {
  const team = await fixture.createTeamChannel();
  const sent = await team.asOwner.send(team.channel.id, {
    content: 'Shipping today',
    requestKey: 'shipping',
    routing: 'fallback',
  });
  const reactionsOn = async (messageId = sent.id) =>
    (await team.asMember.detail(team.channel.id)).messages.find(({ id }) => id === messageId)
      ?.reactions;
  return { ...team, reactionsOn, sent };
};

/** The member asks an Agent, whose run is now running. */
const running = async () => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Helper');
  const request = await team.asMember.send(team.channel.id, {
    content: 'Please look at this',
    mentions: [agent.id],
    requestKey: 'react-request',
    routing: 'decision',
  });
  const [job] = await jobsOf(db, request.id);
  const claim = (await execution.claim(team.channel.id, job.id, lease))!;
  const operationId = claim.job.operationId!;
  await db
    .update(agentOperations)
    .set({ status: 'running' })
    .where(eq(agentOperations.id, operationId));
  const history = new ChannelHistoryRepository(db, fixture.memberId, fixture.workspaceId);
  return { ...team, agent, history, operationId, request };
};

describe('normalizeReactionEmoji', () => {
  it.each(['👍', ' ✅ ', '👍🏽', '👨‍👩‍👧', '🇨🇳', '1️⃣', '❤️'])('accepts %s', (emoji) => {
    expect(normalizeReactionEmoji(emoji)).toBe(emoji.trim());
  });

  it.each(['', 'ok', ':+1:', 'emj_abc', '👍👍', '1', '👍 hi'])('refuses %j', (emoji) => {
    expect(() => normalizeReactionEmoji(emoji)).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });
});

describe('setReaction for a person', () => {
  it('adds, then removes, the caller’s reaction, and every member sees it', async () => {
    const { asMember, asOwner, channel, member, owner, reactionsOn, sent } = await setup();
    expect(await reactionsOn()).toEqual([]);

    expect(await toggle(asOwner, channel.id, sent.id, '👍')).toEqual({
      added: true,
      reactions: [{ count: 1, emoji: '👍', memberIds: [owner.id] }],
    });
    await toggle(asMember, channel.id, sent.id, '👀');
    await toggle(asMember, channel.id, sent.id, '👍');
    // Each emoji keeps the place it was first left in, its members in the order they reacted.
    expect(await reactionsOn()).toEqual([
      { count: 2, emoji: '👍', memberIds: [owner.id, member.id] },
      { count: 1, emoji: '👀', memberIds: [member.id] },
    ]);

    expect(await toggle(asOwner, channel.id, sent.id, '👍')).toMatchObject({
      added: false,
    });
    // 👍 now dates from the member's reaction, left after their 👀.
    expect(await reactionsOn()).toEqual([
      { count: 1, emoji: '👀', memberIds: [member.id] },
      { count: 1, emoji: '👍', memberIds: [member.id] },
    ]);
  });

  it('does not post, route or count as unread', async () => {
    const { asMember, asOwner, channel, sent } = await setup();
    const unread = async () =>
      (await asMember.list()).find(({ id }) => id === channel.id)?.unreadCount;
    const before = { jobs: await jobsOf(db, sent.id), unread: await unread() };
    const messages = (await asMember.detail(channel.id)).messages.map(({ id }) => id);

    await toggle(asOwner, channel.id, sent.id, '🎉');

    expect((await asMember.detail(channel.id)).messages.map(({ id }) => id)).toEqual(messages);
    expect(await jobsOf(db, sent.id)).toEqual(before.jobs);
    expect(await unread()).toBe(before.unread);
  });

  it('refuses a deleted message and hides what it had', async () => {
    const { asMember, asOwner, channel, reactionsOn, sent } = await setup();
    await toggle(asMember, channel.id, sent.id, '👍');
    await asOwner.deleteMessage(channel.id, sent.id);
    expect(await reactionsOn()).toEqual([]);
    await expect(toggle(asOwner, channel.id, sent.id, '👀')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses a message of another Channel and someone outside the Channel', async () => {
    const { asOwner, channel, sent } = await setup();
    const { channel: other } = await asOwner.create({ title: 'Other' });
    await expect(toggle(asOwner, other.id, sent.id, '👍')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const stranger = new ChannelRepository(db, 'channel-reactions-nobody', fixture.workspaceId);
    await expect(toggle(stranger, channel.id, sent.id, '👍')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it(`caps one member at ${CHANNEL_REACTIONS_PER_MEMBER} emoji on a message`, async () => {
    const { asOwner, channel, owner, sent } = await setup();
    await db.insert(channelMessageReactions).values(
      Array.from({ length: CHANNEL_REACTIONS_PER_MEMBER }, (_, index) => ({
        channelId: channel.id,
        emoji: String.fromCodePoint(0x1f600 + index),
        memberId: owner.id,
        messageId: sent.id,
      })),
    );
    await expect(toggle(asOwner, channel.id, sent.id, '👍')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    // Taking one back still works at the cap.
    expect(await toggle(asOwner, channel.id, sent.id, '😀')).toMatchObject({
      added: false,
    });
  });
});

describe('reactions in a large Channel', () => {
  it(`names at most ${REACTION_MEMBER_PREVIEW} members per emoji, always including the viewer`, async () => {
    const { asMember, asOwner, channel, member, reactionsOn, sent } = await setup();
    const agents = [];
    for (let i = 0; i <= REACTION_MEMBER_PREVIEW; i++)
      agents.push(await fixture.addAgent(channel.id, `Agent ${i}`));
    await db.insert(channelMessageReactions).values(
      agents.map((agent) => ({
        channelId: channel.id,
        emoji: '👍',
        memberId: agent.id,
        messageId: sent.id,
      })),
    );
    // The member reacts last, past the named preview.
    await toggle(asMember, channel.id, sent.id, '👍');

    const [thumbs] = (await reactionsOn())!;
    expect(thumbs.count).toBe(REACTION_MEMBER_PREVIEW + 2);
    // The Agents reacted in one statement, so which of them are named first is unordered.
    const agentIds = new Set(agents.map((agent) => agent.id));
    expect(thumbs.memberIds.slice(0, REACTION_MEMBER_PREVIEW).every((id) => agentIds.has(id))).toBe(
      true,
    );
    expect(thumbs.memberIds).toHaveLength(REACTION_MEMBER_PREVIEW + 1);
    expect(thumbs.memberIds.at(-1)).toBe(member.id);

    // Someone else sees the same count with only the first members named.
    const [seen] = (await asOwner.detail(channel.id)).messages.find(
      ({ id }) => id === sent.id,
    )!.reactions!;
    expect(seen.count).toBe(REACTION_MEMBER_PREVIEW + 2);
    expect(seen.memberIds).toHaveLength(REACTION_MEMBER_PREVIEW);
  });

  it(`caps a message at ${CHANNEL_REACTION_EMOJI_PER_MESSAGE} different emoji`, async () => {
    const { asMember, asOwner, channel, owner, sent } = await setup();
    const agents = [];
    for (
      let i = 0;
      i < Math.ceil(CHANNEL_REACTION_EMOJI_PER_MESSAGE / CHANNEL_REACTIONS_PER_MEMBER);
      i++
    )
      agents.push(await fixture.addAgent(channel.id, `Agent ${i}`));
    await db.insert(channelMessageReactions).values(
      Array.from({ length: CHANNEL_REACTION_EMOJI_PER_MESSAGE }, (_, index) => ({
        channelId: channel.id,
        emoji: String.fromCodePoint(0x1f600 + index),
        memberId: agents[Math.floor(index / CHANNEL_REACTIONS_PER_MEMBER)].id,
        messageId: sent.id,
      })),
    );
    await expect(toggle(asOwner, channel.id, sent.id, '🧀')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    // Joining an emoji already there is still fine.
    expect(await toggle(asMember, channel.id, sent.id, '😀')).toMatchObject({ added: true });
    expect(owner.id).toBeTruthy();
  });
});

describe('ChannelHistoryRepository.react', () => {
  it('reacts as the run’s Agent, alongside people, and takes it back', async () => {
    const { agent, asMember, channel, history, member, operationId, request } = await running();
    await toggle(asMember, channel.id, request.id, '👀');

    expect(await history.react(operationId, { emoji: '👀', messageId: request.id }, true)).toEqual({
      added: true,
      channelId: channel.id,
      emoji: '👀',
      messageId: request.id,
    });
    // A retried add does not undo itself.
    expect(
      (await history.react(operationId, { emoji: '👀', messageId: request.id }, true)).added,
    ).toBe(true);
    const seen = async () =>
      (await asMember.detail(channel.id)).messages.find(({ id }) => id === request.id)?.reactions;
    expect(await seen()).toEqual([{ count: 2, emoji: '👀', memberIds: [member.id, agent.id] }]);

    await history.react(operationId, { emoji: '👀', messageId: request.id }, false);
    expect(await seen()).toEqual([{ count: 1, emoji: '👀', memberIds: [member.id] }]);
  });

  it('only reaches messages of its own conversation', async () => {
    const { asOwner, history, operationId } = await running();
    const { channel: other } = await asOwner.create({ title: 'Elsewhere' });
    const elsewhere = await asOwner.send(other.id, {
      content: 'Not yours',
      requestKey: 'elsewhere',
      routing: 'fallback',
    });
    await expect(
      history.react(operationId, { emoji: '👍', messageId: elsewhere.id }, true),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      history.react(operationId, { emoji: 'yes', messageId: elsewhere.id }, true),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('frequentReactions', () => {
  it('ranks the caller’s own reactions of the last 90 days, by use and then recency', async () => {
    const { asMember, asOwner, channel, owner, sent } = await setup();
    const second = await asOwner.send(channel.id, {
      content: 'And another',
      requestKey: 'another',
      routing: 'fallback',
    });
    const { channel: other } = await asOwner.create({ title: 'Other' });
    const elsewhere = await asOwner.send(other.id, {
      content: 'Elsewhere',
      requestKey: 'elsewhere',
      routing: 'fallback',
    });

    await toggle(asOwner, channel.id, sent.id, '🎉');
    await toggle(asOwner, channel.id, sent.id, '👀');
    await toggle(asOwner, channel.id, second.id, '👀');
    // Reactions in every Channel count.
    await toggle(asOwner, other.id, elsewhere.id, '👀');
    await toggle(asOwner, channel.id, second.id, '🙌');
    // Someone else's reactions are theirs.
    await toggle(asMember, channel.id, sent.id, '🤔');
    await toggle(asMember, channel.id, second.id, '🤔');
    // Too old to count.
    await db.insert(channelMessageReactions).values({
      channelId: channel.id,
      createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      emoji: '🔥',
      memberId: owner.id,
      messageId: second.id,
    });

    // 👀 three times; 🎉 and 🙌 once each, 🙌 the more recent.
    expect(await frequentReactions(db, fixture.ownerId)).toEqual(['👀', '🙌', '🎉']);
    expect(await frequentReactions(db, fixture.memberId)).toEqual(['🤔']);
  });
});
