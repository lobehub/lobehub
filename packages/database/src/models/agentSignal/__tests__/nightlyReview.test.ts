// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messagePlugins, messages, topics, users, userSettings } from '../../../schemas';
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
    it('lists only users with AgentSignal self-iteration enabled', async () => {
      await serverDB.insert(users).values([
        {
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          id: enabledUserId,
          preference: { lab: { enableAgentSelfIteration: true } },
        },
        {
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
          id: enabledUserWithoutTimezoneId,
          preference: { lab: { enableAgentSelfIteration: true } },
        },
        {
          createdAt: new Date('2026-05-03T00:00:00.000Z'),
          id: disabledUserId,
          preference: { lab: { enableAgentSelfIteration: false } },
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
      ]);
    });

    it('uses cursor and whitelist filters for targeted scheduling pages', async () => {
      await serverDB.insert(users).values([
        {
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          id: enabledUserId,
          preference: { lab: { enableAgentSelfIteration: true } },
        },
        {
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
          id: enabledUserWithoutTimezoneId,
          preference: { lab: { enableAgentSelfIteration: true } },
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
  });

  describe('listActiveAgentTargets', () => {
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
              chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: true } },
              id: 'nightly-active-agent',
              title: 'Active agent',
              userId: enabledUserId,
            },
            {
              chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: true } },
              id: 'nightly-legacy-agent',
              title: 'Legacy agent',
              userId: enabledUserId,
            },
            {
              chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: true } },
              id: 'nightly-inactive-agent',
              title: 'Inactive agent',
              userId: enabledUserId,
            },
            {
              chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: false } },
              id: 'nightly-disabled-agent',
              title: 'Disabled agent',
              userId: enabledUserId,
            },
            {
              chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: true } },
              id: 'nightly-virtual-agent',
              title: 'Virtual agent',
              userId: enabledUserId,
              virtual: true,
            },
            {
              chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: true } },
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
          timezone: 'America/New_York',
          title: 'Active agent',
          topicCount: 1,
        },
      ]);
    });
  });
});
