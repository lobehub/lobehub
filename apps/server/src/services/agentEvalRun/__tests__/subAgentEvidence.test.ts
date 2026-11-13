// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { messagePlugins, messages, threads } from '@/database/schemas';

import { buildJudgeEvidence } from '../judge';
import { withSubAgentMessages } from '../subAgentEvidence';
import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

const toolMessage = async (params: {
  apiName: string;
  content: string;
  identifier: string;
  threadId?: string;
  topicId: string;
}) => {
  const [message] = await serverDB
    .insert(messages)
    .values({
      content: params.content,
      role: 'tool',
      threadId: params.threadId,
      topicId: params.topicId,
      userId,
    })
    .returning();
  await serverDB.insert(messagePlugins).values({
    apiName: params.apiName,
    arguments: '{}',
    id: message.id,
    identifier: params.identifier,
    toolCallId: `call_${message.id}`,
    userId,
  });
  return message;
};

const isolationThread = async (topicId: string, sourceMessageId: string, title: string) => {
  const [thread] = await serverDB
    .insert(threads)
    .values({ sourceMessageId, title, topicId, type: 'isolation', userId })
    .returning();
  return thread;
};

describe('withSubAgentMessages', () => {
  beforeEach(cleanupDB);
  afterEach(cleanupDB);

  it("lays a sub-agent's tool calls, nested ones too, after the call that started it", async () => {
    const { topic } = await setupEvalChain({});
    const deps = { db: serverDB, messageModel: new MessageModel(serverDB, userId), userId };
    const spawn = await toolMessage({
      apiName: 'callSubAgent',
      content: 'Sub-agent summary: posted the release note.',
      identifier: 'lobe-agent',
      topicId: topic.id,
    });
    const subAgent = await isolationThread(topic.id, spawn.id, 'Release poster');
    const nestedSpawn = await toolMessage({
      apiName: 'callSubAgent',
      content: 'Nested summary.',
      identifier: 'lobe-agent',
      threadId: subAgent.id,
      topicId: topic.id,
    });
    await toolMessage({
      apiName: 'postMessage',
      content: '{"ok":true}',
      identifier: 'slack-mcp',
      threadId: subAgent.id,
      topicId: topic.id,
    });
    const nested = await isolationThread(topic.id, nestedSpawn.id, 'Checker');
    await toolMessage({
      apiName: 'readChannel',
      content: '{"messages":1}',
      identifier: 'slack-mcp',
      threadId: nested.id,
      topicId: topic.id,
    });

    const attempt = await deps.messageModel.query({ topicId: topic.id });
    // The attempt's own list never sees the sub-agent's work.
    expect(attempt.map((message) => message.id)).toEqual([spawn.id]);

    const evidence = buildJudgeEvidence({
      messages: await withSubAgentMessages(deps, { messages: attempt, topicId: topic.id }),
    });

    expect(evidence).toContain('[sub-agent: …] was made by a sub-agent the agent started');
    const lines = evidence.split('\n').filter((line) => /^\d+\. /.test(line));
    expect(lines).toEqual([
      expect.stringMatching(/^1\. lobe-agent\.callSubAgent\(/),
      expect.stringMatching(/^2\. \[sub-agent: Release poster\] lobe-agent\.callSubAgent\(/),
      expect.stringMatching(/^3\. \[sub-agent: Checker\] slack-mcp\.readChannel\(/),
      expect.stringMatching(/^4\. \[sub-agent: Release poster\] slack-mcp\.postMessage\(/),
    ]);
  });

  it('leaves an attempt without sub-agents as it was', async () => {
    const { topic } = await setupEvalChain({});
    const deps = { db: serverDB, messageModel: new MessageModel(serverDB, userId), userId };
    await toolMessage({ apiName: 'search', content: '[]', identifier: 'web', topicId: topic.id });
    const attempt = await deps.messageModel.query({ topicId: topic.id });

    expect(await withSubAgentMessages(deps, { messages: attempt, topicId: topic.id })).toBe(
      attempt,
    );
  });
});
