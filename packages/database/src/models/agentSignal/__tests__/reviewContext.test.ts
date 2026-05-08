// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agentDocuments,
  agents,
  documents,
  messagePlugins,
  messages,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentSignalReviewContextModel } from '../reviewContext';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-signal-review-context-user';
const agentId = 'agent-signal-review-context-agent';
const topicId = 'agent-signal-review-context-topic';

beforeEach(async () => {
  await serverDB.delete(users);
});

describe('AgentSignalReviewContextModel', () => {
  describe('listToolActivity', () => {
    it('groups tool activity by identifier and api name with clipped samples', async () => {
      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(agents).values([
        {
          chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: true } },
          id: agentId,
          title: 'Review Context Agent',
          userId,
        },
      ]);
      await serverDB.insert(topics).values({
        agentId,
        id: topicId,
        title: 'Tool activity topic',
        userId,
      });
      await serverDB.insert(messages).values([
        {
          agentId,
          content: 'created document',
          createdAt: new Date('2026-05-03T12:00:00.000Z'),
          id: 'agent-signal-review-context-tool-1',
          role: 'assistant',
          topicId,
          userId,
        },
        {
          agentId,
          content: 'document tool failed',
          createdAt: new Date('2026-05-03T13:00:00.000Z'),
          id: 'agent-signal-review-context-tool-2',
          role: 'assistant',
          topicId,
          userId,
        },
        {
          agentId,
          content: 'outside window',
          createdAt: new Date('2026-05-04T13:00:00.000Z'),
          id: 'agent-signal-review-context-tool-outside',
          role: 'assistant',
          topicId,
          userId,
        },
      ]);
      await serverDB.insert(messagePlugins).values([
        {
          apiName: 'createDocument',
          arguments: '{"title":"Release Skill"}',
          id: 'agent-signal-review-context-tool-1',
          identifier: 'lobe-agent-documents',
          toolCallId: 'tool-call-review-context-1',
          userId,
        },
        {
          apiName: 'createDocument',
          arguments: '{"title":"Release Skill"}',
          error: { message: 'timeout while creating document' },
          id: 'agent-signal-review-context-tool-2',
          identifier: 'lobe-agent-documents',
          toolCallId: 'tool-call-review-context-2',
          userId,
        },
        {
          apiName: 'createDocument',
          arguments: '{"title":"Outside"}',
          id: 'agent-signal-review-context-tool-outside',
          identifier: 'lobe-agent-documents',
          toolCallId: 'tool-call-review-context-outside',
          userId,
        },
      ]);

      const model = new AgentSignalReviewContextModel(serverDB, userId);

      const result = await model.listToolActivity({
        agentId,
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      });

      expect(result).toEqual([
        expect.objectContaining({
          apiName: 'createDocument',
          failedCount: 1,
          identifier: 'lobe-agent-documents',
          messageIds: expect.arrayContaining([
            'agent-signal-review-context-tool-1',
            'agent-signal-review-context-tool-2',
          ]),
          sampleArgs: expect.arrayContaining([expect.stringContaining('Release Skill')]),
          sampleErrors: [expect.stringContaining('timeout while creating document')],
          topicIds: [topicId],
          totalCount: 2,
        }),
      ]);
    });
  });

  describe('listDocumentActivity', () => {
    it('returns review-window document activity with agent signal skill hints', async () => {
      const agentDocumentId = '00000000-0000-0000-0000-000000000101';

      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(agents).values([
        {
          chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: true } },
          id: agentId,
          title: 'Review Context Agent',
          userId,
        },
      ]);
      await serverDB.insert(documents).values([
        {
          content: 'Reusable release workflow.',
          fileType: 'md',
          id: 'agent-signal-review-context-doc-skill',
          metadata: {
            agentSignal: {
              hintedByTool: 'lobe-agent-documents.createDocument',
              hintIsSkill: true,
            },
          },
          source: 'agent-signal',
          sourceType: 'agent-signal',
          title: 'Release workflow skill',
          totalCharCount: 26,
          totalLineCount: 1,
          userId,
        },
        {
          content: 'Outside window.',
          fileType: 'md',
          id: 'agent-signal-review-context-doc-outside',
          metadata: {
            agentSignal: {
              hintedByTool: 'lobe-agent-documents.createDocument',
              hintIsSkill: true,
            },
          },
          source: 'agent-signal',
          sourceType: 'agent-signal',
          title: 'Outside skill',
          totalCharCount: 15,
          totalLineCount: 1,
          userId,
        },
      ]);
      await serverDB.insert(agentDocuments).values([
        {
          agentId,
          documentId: 'agent-signal-review-context-doc-skill',
          id: agentDocumentId,
          updatedAt: new Date('2026-05-03T12:00:00.000Z'),
          userId,
        },
        {
          agentId,
          documentId: 'agent-signal-review-context-doc-outside',
          id: '00000000-0000-0000-0000-000000000102',
          updatedAt: new Date('2026-05-04T12:00:00.000Z'),
          userId,
        },
      ]);

      const model = new AgentSignalReviewContextModel(serverDB, userId);

      const result = await model.listDocumentActivity({
        agentId,
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      });

      expect(result).toEqual([
        expect.objectContaining({
          agentDocumentId,
          documentId: 'agent-signal-review-context-doc-skill',
          hintIsSkill: true,
          title: 'Release workflow skill',
        }),
      ]);
    });
  });

  describe('listTopicActivity', () => {
    it('returns bounded failed tool and message evidence for nightly self-review', async () => {
      await serverDB.insert(users).values({ id: userId });
      await serverDB.insert(agents).values([
        {
          chatConfig: { autoCreateTopicThreshold: 2, selfIteration: { enabled: true } },
          id: agentId,
          title: 'Review Context Agent',
          userId,
        },
      ]);
      await serverDB.insert(topics).values({
        agentId,
        id: topicId,
        title: 'Tool failure topic',
        userId,
      });
      await serverDB.insert(messages).values([
        {
          agentId,
          content: 'assistant failed',
          createdAt: new Date('2026-05-03T12:00:00.000Z'),
          error: { message: 'model failed after tool output' },
          id: 'agent-signal-review-context-message-error',
          role: 'assistant',
          topicId,
          userId,
        },
        {
          agentId,
          content: 'tool failed',
          createdAt: new Date('2026-05-03T13:00:00.000Z'),
          id: 'agent-signal-review-context-tool-error',
          role: 'assistant',
          topicId,
          userId,
        },
      ]);
      await serverDB.insert(messagePlugins).values({
        apiName: 'search',
        error: { message: 'upstream timeout while fetching comments' },
        id: 'agent-signal-review-context-tool-error',
        identifier: 'web-search',
        toolCallId: 'tool-call-review-context',
        userId,
      });

      const model = new AgentSignalReviewContextModel(serverDB, userId);

      const result = await model.listTopicActivity({
        agentId,
        limit: 10,
        windowEnd: new Date('2026-05-03T23:59:59.999Z'),
        windowStart: new Date('2026-05-03T00:00:00.000Z'),
      });

      expect(result).toEqual([
        expect.objectContaining({
          failedMessages: [
            {
              errorSummary: '{"message": "model failed after tool output"}',
              messageId: 'agent-signal-review-context-message-error',
            },
          ],
          failedToolCalls: [
            {
              apiName: 'search',
              errorSummary: '{"message": "upstream timeout while fetching comments"}',
              identifier: 'web-search',
              messageId: 'agent-signal-review-context-tool-error',
              toolCallId: 'tool-call-review-context',
            },
          ],
          failedToolCount: 1,
          failureCount: 1,
          topicId,
        }),
      ]);
    });
  });
});
