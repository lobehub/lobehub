// @vitest-environment node
import { INBOX_SESSION_ID } from '@lobechat/const';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  messagePlugins,
  messages,
  topics,
  users,
  userSettings,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentSignalNightlyReviewModel } from '../nightlyReview';

const serverDB: LobeChatDatabase = await getTestDB();

const enabledUserId = 'nightly-review-enabled-user';
const enabledUserWithoutTimezoneId = 'nightly-review-enabled-user-utc';
const disabledUserId = 'nightly-review-disabled-user';
const otherUserId = 'nightly-review-other-user';

beforeEach(async () => {
  await serverDB.delete(users);
});

describe('AgentSignalNightlyReviewModel', () => {
  describe('listEligibleUsers', () => {
    it('lists all users regardless of the lab opt-in preference', async () => {
      await serverDB.insert(users).values([
        {
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          id: enabledUserId,
        },
        {
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
          id: enabledUserWithoutTimezoneId,
        },
        {
          createdAt: new Date('2026-05-03T00:00:00.000Z'),
          id: disabledUserId,
        },
      ]);
      await serverDB.insert(userSettings).values({
        general: { timezone: 'Asia/Shanghai' },
        id: enabledUserId,
      });

      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listEligibleUsers();

      expect(result).toEqual([
        {
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          id: enabledUserId,
          timezone: 'Asia/Shanghai',
        },
        {
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
          id: enabledUserWithoutTimezoneId,
          timezone: 'UTC',
        },
        {
          createdAt: new Date('2026-05-03T00:00:00.000Z'),
          id: disabledUserId,
          timezone: 'UTC',
        },
      ]);
    });

    it('uses cursor and whitelist filters for targeted scheduling pages', async () => {
      await serverDB.insert(users).values([
        {
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          id: enabledUserId,
        },
        {
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
          id: enabledUserWithoutTimezoneId,
        },
      ]);

      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listEligibleUsers({
        cursor: { createdAt: new Date('2026-05-01T00:00:00.000Z'), id: enabledUserId },
        limit: 1,
        whitelist: [enabledUserWithoutTimezoneId],
      });

      expect(result).toEqual([
        {
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
          id: enabledUserWithoutTimezoneId,
          timezone: 'UTC',
        },
      ]);
    });

    /**
     * @example
     * expect(nextPage.map((user) => user.id)).toEqual(['nightly-review-microsecond-next']);
     */
    it('does not repeat a cursor row whose database timestamp has sub-millisecond precision', async () => {
      // ROOT CAUSE:
      //
      // PostgreSQL timestamps can retain microseconds while JavaScript Date and workflow JSON retain
      // only milliseconds. Comparing the truncated Date back to created_at made the cursor row appear
      // newer than itself and caused an unbounded pagination loop.
      //
      // Before: created_at .000123 > replayed cursor .000, so the same user was returned again.
      // After: the cursor id restores the exact (created_at, id) tuple inside PostgreSQL.
      await serverDB.execute(sql`
        INSERT INTO users (id, created_at, updated_at, last_active_at)
        VALUES
          ('nightly-review-microsecond-cursor', '2026-05-01T00:00:00.000123Z', NOW(), NOW()),
          ('nightly-review-microsecond-next', '2026-05-02T00:00:00.000456Z', NOW(), NOW())
      `);

      const model = new AgentSignalNightlyReviewModel(serverDB);
      const firstPage = await model.listEligibleUsers({ limit: 1 });
      const nextPage = await model.listEligibleUsers({
        cursor: { createdAt: firstPage[0].createdAt, id: firstPage[0].id },
        limit: 1,
      });

      expect(firstPage.map((user) => user.id)).toEqual(['nightly-review-microsecond-cursor']);
      expect(nextPage.map((user) => user.id)).toEqual(['nightly-review-microsecond-next']);
    });
  });

  describe('listEligibleUsers narrowing', () => {
    /**
     * ROOT CAUSE:
     *
     * `listEligibleUsers` had no predicate at all, so the hourly cron fanned one workflow run
     * out per row of a 321k-row `users` table to reach the handful of users whose local clock
     * was actually inside the 02:00-04:00 review window. At a 5/s flow-control ceiling one pass
     * needed ~18h while the cron fired every hour, so the backlog — and every user's effective
     * review time — drifted later every day.
     *
     * The activity floor is a strict superset of every per-user review window, so narrowing on
     * it can only skip a dispatch the local-window check would have skipped anyway. The window
     * itself stays in the service layer, which resolves timezones through `Intl`; pushing it
     * into SQL would make the scan depend on the database's tzdata build agreeing with `Intl`,
     * and it buys little at the busiest hour anyway.
     */
    const seedActivity = async () => {
      await serverDB.insert(users).values([
        { createdAt: new Date('2026-05-01T00:00:00.000Z'), id: enabledUserId },
        { createdAt: new Date('2026-05-02T00:00:00.000Z'), id: otherUserId },
      ]);
      await serverDB.insert(userSettings).values([
        { general: { timezone: 'Asia/Shanghai' }, id: enabledUserId },
        { general: { timezone: 'America/New_York' }, id: otherUserId },
      ]);
      await serverDB.insert(agents).values([
        { id: 'nightly-active-agent', slug: INBOX_SESSION_ID, userId: enabledUserId },
        { id: 'nightly-stale-agent', slug: INBOX_SESSION_ID, userId: otherUserId },
      ]);
      await serverDB.insert(topics).values([
        { agentId: 'nightly-active-agent', id: 'nightly-active-topic', userId: enabledUserId },
        { agentId: 'nightly-stale-agent', id: 'nightly-stale-topic', userId: otherUserId },
      ]);
      await serverDB.insert(messages).values([
        {
          agentId: 'nightly-active-agent',
          createdAt: new Date('2026-05-03T09:00:00.000Z'),
          id: 'nightly-active-message',
          role: 'user',
          topicId: 'nightly-active-topic',
          userId: enabledUserId,
        },
        {
          agentId: 'nightly-stale-agent',
          createdAt: new Date('2026-04-01T09:00:00.000Z'),
          id: 'nightly-stale-message',
          role: 'user',
          topicId: 'nightly-stale-topic',
          userId: otherUserId,
        },
      ]);
    };

    /**
     * @example
     * expect(result.map((item) => item.id)).toEqual([enabledUserId]);
     */
    it('drops users with no message activity since the floor', async () => {
      await seedActivity();
      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listEligibleUsers({
        activeSince: new Date('2026-05-02T12:05:00.000Z'),
      });

      expect(result).toEqual([
        {
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          id: enabledUserId,
          timezone: 'Asia/Shanghai',
        },
      ]);
    });

    /**
     * Workspace messages belong to a different review surface, so they must not keep a user in
     * the personal nightly scan.
     *
     * @example
     * expect(result).toEqual([]);
     */
    it('ignores workspace activity when deciding who is a candidate', async () => {
      await serverDB.insert(users).values({
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        id: enabledUserId,
      });
      const [workspace] = await serverDB
        .insert(workspaces)
        .values({
          name: 'nightly-review-workspace',
          primaryOwnerId: enabledUserId,
          slug: 'nightly-review-workspace',
        })
        .returning();
      await serverDB.insert(agents).values({
        id: 'nightly-workspace-agent',
        slug: INBOX_SESSION_ID,
        userId: enabledUserId,
        workspaceId: workspace!.id,
      });
      await serverDB.insert(topics).values({
        agentId: 'nightly-workspace-agent',
        id: 'nightly-workspace-topic',
        userId: enabledUserId,
        workspaceId: workspace!.id,
      });
      await serverDB.insert(messages).values({
        agentId: 'nightly-workspace-agent',
        createdAt: new Date('2026-05-03T09:00:00.000Z'),
        id: 'nightly-workspace-message',
        role: 'user',
        topicId: 'nightly-workspace-topic',
        userId: enabledUserId,
        workspaceId: workspace!.id,
      });
      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listEligibleUsers({
        activeSince: new Date('2026-05-02T12:05:00.000Z'),
      });

      expect(result).toEqual([]);
    });

    /**
     * A whitelist is an explicit target list for backfills; narrowing it would drop the very
     * rows the caller named.
     *
     * @example
     * expect(result.map((item) => item.id)).toEqual([otherUserId]);
     */
    it('ignores activity narrowing for whitelist runs', async () => {
      await seedActivity();
      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listEligibleUsers({
        activeSince: new Date('2026-05-02T12:05:00.000Z'),
        whitelist: [otherUserId],
      });

      expect(result.map((item) => item.id)).toEqual([otherUserId]);
    });
  });

  describe('listActiveAgentTargets', () => {
    const chatConfigForSelfIteration = (enabled?: boolean) =>
      enabled === undefined ? {} : { selfIteration: { enabled } };

    const seedNightlyCapabilityTargets = async (caseName: string, blockedEnabled?: boolean) => {
      await serverDB.insert(users).values({ id: enabledUserId });

      const [lobeAiAgent, blockedAgent, enabledAgent] = await serverDB
        .insert(agents)
        .values([
          {
            chatConfig: chatConfigForSelfIteration(blockedEnabled),
            id: `nightly-lobe-ai-${caseName}`,
            slug: INBOX_SESSION_ID,
            title: 'Lobe AI',
            userId: enabledUserId,
            virtual: true,
          },
          {
            chatConfig: chatConfigForSelfIteration(blockedEnabled),
            id: `nightly-custom-${caseName}`,
            slug: `custom-${caseName}`,
            title: 'Custom blocked',
            userId: enabledUserId,
          },
          {
            chatConfig: chatConfigForSelfIteration(true),
            id: `nightly-custom-enabled-${caseName}`,
            slug: `custom-enabled-${caseName}`,
            title: 'Custom enabled',
            userId: enabledUserId,
          },
        ])
        .returning();

      await serverDB.insert(topics).values(
        [lobeAiAgent, blockedAgent, enabledAgent].map((agent) => ({
          agentId: agent.id,
          id: `nightly-topic-${agent.id}`,
          title: agent.title ?? agent.id,
          userId: enabledUserId,
        })),
      );
      await serverDB.insert(messages).values(
        [lobeAiAgent, blockedAgent, enabledAgent].map((agent, index) => ({
          agentId: agent.id,
          content: `${agent.title} activity`,
          createdAt: new Date(`2026-05-03T1${index + 2}:00:00.000Z`),
          id: `nightly-message-${agent.id}`,
          role: 'user' as const,
          topicId: `nightly-topic-${agent.id}`,
          userId: enabledUserId,
        })),
      );

      return { blockedAgent, enabledAgent, lobeAiAgent };
    };

    /**
     * @example
     * expect(result.map((item) => item.agentId)).toEqual(['nightly-lobe-ai-disabled']).
     */
    it('includes Lobe AI when the agent switch is disabled and excludes non-Lobe disabled agents', async () => {
      const { blockedAgent, enabledAgent, lobeAiAgent } = await seedNightlyCapabilityTargets(
        'disabled',
        false,
      );

      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listActiveAgentTargets(enabledUserId, {
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      });

      expect(result.map((item) => item.agentId)).toEqual([enabledAgent.id, lobeAiAgent.id]);
      expect(result.map((item) => item.agentId)).not.toContain(blockedAgent.id);
    });

    /**
     * @example
     * expect(result.map((item) => item.agentId)).toEqual(['nightly-lobe-ai-implicit']).
     */
    it('includes Lobe AI when the agent switch is missing and excludes non-Lobe implicit agents', async () => {
      const { blockedAgent, enabledAgent, lobeAiAgent } =
        await seedNightlyCapabilityTargets('implicit');

      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listActiveAgentTargets(enabledUserId, {
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      });

      expect(result.map((item) => item.agentId)).toEqual([enabledAgent.id, lobeAiAgent.id]);
      expect(result.map((item) => item.agentId)).not.toContain(blockedAgent.id);
    });

    it('returns non-virtual agents with activity and failure counts inside the review window', async () => {
      await serverDB.insert(users).values([{ id: enabledUserId }, { id: otherUserId }]);
      await serverDB.insert(userSettings).values({
        general: { timezone: 'America/New_York' },
        id: enabledUserId,
      });

      const [activeAgent, legacyAgent, inactiveAgent, disabledAgent, virtualAgent, otherUserAgent] =
        await serverDB
          .insert(agents)
          .values([
            {
              chatConfig: { selfIteration: { enabled: true } },
              id: 'nightly-active-agent',
              title: 'Active agent',
              userId: enabledUserId,
            },
            {
              chatConfig: { selfIteration: { enabled: true } },
              id: 'nightly-legacy-agent',
              title: 'Legacy agent',
              userId: enabledUserId,
            },
            {
              chatConfig: { selfIteration: { enabled: true } },
              id: 'nightly-inactive-agent',
              title: 'Inactive agent',
              userId: enabledUserId,
            },
            {
              chatConfig: { selfIteration: { enabled: false } },
              id: 'nightly-disabled-agent',
              title: 'Disabled agent',
              userId: enabledUserId,
            },
            {
              chatConfig: { selfIteration: { enabled: true } },
              id: 'nightly-virtual-agent',
              title: 'Virtual agent',
              userId: enabledUserId,
              virtual: true,
            },
            {
              chatConfig: { selfIteration: { enabled: true } },
              id: 'nightly-other-user-agent',
              title: 'Other user',
              userId: otherUserId,
            },
          ])
          .returning();

      await serverDB.insert(topics).values([
        {
          agentId: activeAgent.id,
          id: 'nightly-topic-active',
          title: 'Active',
          userId: enabledUserId,
        },
        {
          agentId: legacyAgent.id,
          id: 'nightly-topic-legacy',
          title: 'Legacy',
          userId: enabledUserId,
        },
        {
          agentId: disabledAgent.id,
          id: 'nightly-topic-disabled',
          title: 'Disabled',
          userId: enabledUserId,
        },
        {
          agentId: virtualAgent.id,
          id: 'nightly-topic-virtual',
          title: 'Virtual',
          userId: enabledUserId,
        },
        {
          agentId: otherUserAgent.id,
          id: 'nightly-topic-other-user',
          title: 'Other',
          userId: otherUserId,
        },
      ]);

      await serverDB.insert(messages).values([
        {
          agentId: activeAgent.id,
          content: 'inside first',
          createdAt: new Date('2026-05-03T12:00:00.000Z'),
          id: 'nightly-message-active-1',
          role: 'user',
          topicId: 'nightly-topic-active',
          userId: enabledUserId,
        },
        {
          agentId: activeAgent.id,
          content: 'failed tool result',
          createdAt: new Date('2026-05-03T13:00:00.000Z'),
          id: 'nightly-message-active-2',
          role: 'assistant',
          topicId: 'nightly-topic-active',
          userId: enabledUserId,
        },
        {
          content: 'legacy message uses topic agent',
          createdAt: new Date('2026-05-03T14:00:00.000Z'),
          id: 'nightly-message-legacy',
          role: 'user',
          topicId: 'nightly-topic-legacy',
          userId: enabledUserId,
        },
        {
          agentId: activeAgent.id,
          content: 'outside window',
          createdAt: new Date('2026-05-02T23:59:59.000Z'),
          id: 'nightly-message-outside',
          role: 'user',
          topicId: 'nightly-topic-active',
          userId: enabledUserId,
        },
        {
          agentId: disabledAgent.id,
          content: 'disabled agent should not schedule',
          createdAt: new Date('2026-05-03T14:30:00.000Z'),
          id: 'nightly-message-disabled',
          role: 'user',
          topicId: 'nightly-topic-disabled',
          userId: enabledUserId,
        },
        {
          agentId: virtualAgent.id,
          content: 'virtual should not schedule',
          createdAt: new Date('2026-05-03T15:00:00.000Z'),
          id: 'nightly-message-virtual',
          role: 'user',
          topicId: 'nightly-topic-virtual',
          userId: enabledUserId,
        },
        {
          agentId: otherUserAgent.id,
          content: 'other user should not leak',
          createdAt: new Date('2026-05-03T16:00:00.000Z'),
          id: 'nightly-message-other-user',
          role: 'user',
          topicId: 'nightly-topic-other-user',
          userId: otherUserId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        error: { message: 'tool failed' },
        id: 'nightly-message-active-2',
        userId: enabledUserId,
      });

      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listActiveAgentTargets(enabledUserId, {
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      });

      expect(result).toEqual([
        {
          agentId: legacyAgent.id,
          failedToolCallCount: 0,
          firstActivityAt: new Date('2026-05-03T14:00:00.000Z'),
          lastActivityAt: new Date('2026-05-03T14:00:00.000Z'),
          messageCount: 1,
          name: null,
          timezone: 'America/New_York',
          title: 'Legacy agent',
          topicCount: 1,
        },
        {
          agentId: activeAgent.id,
          failedToolCallCount: 1,
          firstActivityAt: new Date('2026-05-03T12:00:00.000Z'),
          lastActivityAt: new Date('2026-05-03T13:00:00.000Z'),
          messageCount: 2,
          name: null,
          timezone: 'America/New_York',
          title: 'Active agent',
          topicCount: 1,
        },
      ]);
      expect(result.map((item) => item.agentId)).not.toContain(inactiveAgent.id);
      expect(result.map((item) => item.agentId)).not.toContain(disabledAgent.id);
      expect(result.map((item) => item.agentId)).not.toContain(virtualAgent.id);
      expect(result.map((item) => item.agentId)).not.toContain(otherUserAgent.id);

      const targetedResult = await model.listActiveAgentTargets(enabledUserId, {
        agentId: activeAgent.id,
        limit: 1,
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      });

      expect(targetedResult).toEqual([
        {
          agentId: activeAgent.id,
          failedToolCallCount: 1,
          firstActivityAt: new Date('2026-05-03T12:00:00.000Z'),
          lastActivityAt: new Date('2026-05-03T13:00:00.000Z'),
          messageCount: 2,
          name: null,
          timezone: 'America/New_York',
          title: 'Active agent',
          topicCount: 1,
        },
      ]);
    });

    it('excludes messages inside an agent-share visitor topic from the nightly digest', async () => {
      // Agent-share visitor topics keep the creator's userId on both the topic
      // and its messages, but a non-null topics.senderId marks the topic as
      // visitor traffic that must not feed the creator's own nightly review.
      await serverDB.insert(users).values({ id: enabledUserId });
      await serverDB.insert(agents).values({
        chatConfig: { selfIteration: { enabled: true } },
        id: 'nightly-share-agent',
        title: 'Share agent',
        userId: enabledUserId,
      });
      await serverDB.insert(topics).values([
        {
          agentId: 'nightly-share-agent',
          id: 'nightly-visitor-topic',
          senderId: 'visitor-user-x',
          title: 'Visitor topic',
          userId: enabledUserId,
        },
        {
          agentId: 'nightly-share-agent',
          id: 'nightly-creator-topic',
          title: 'Creator topic',
          userId: enabledUserId,
        },
      ]);
      await serverDB.insert(messages).values([
        {
          agentId: 'nightly-share-agent',
          content: 'visitor message',
          createdAt: new Date('2026-05-03T12:00:00.000Z'),
          id: 'nightly-visitor-message',
          role: 'user',
          topicId: 'nightly-visitor-topic',
          userId: enabledUserId,
        },
        {
          agentId: 'nightly-share-agent',
          content: 'creator message',
          createdAt: new Date('2026-05-03T13:00:00.000Z'),
          id: 'nightly-creator-message',
          role: 'user',
          topicId: 'nightly-creator-topic',
          userId: enabledUserId,
        },
      ]);

      const model = new AgentSignalNightlyReviewModel(serverDB);

      const result = await model.listActiveAgentTargets(enabledUserId, {
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      });

      // Only the creator's own message counts; the visitor's message is excluded
      expect(result).toEqual([
        {
          agentId: 'nightly-share-agent',
          failedToolCallCount: 0,
          firstActivityAt: new Date('2026-05-03T13:00:00.000Z'),
          lastActivityAt: new Date('2026-05-03T13:00:00.000Z'),
          messageCount: 1,
          name: null,
          timezone: 'UTC',
          title: 'Share agent',
          topicCount: 1,
        },
      ]);
    });
  });
});
