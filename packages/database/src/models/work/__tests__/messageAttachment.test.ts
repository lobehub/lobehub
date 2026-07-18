// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { messages } from '../../../schemas';
import { MessageModel } from '../../message';
import { TaskModel } from '../../task';
import { WorkModel } from '..';
import { cleanupWorkTestData, seedWorkTestData, serverDB, topicId, userId } from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

/**
 * Works ride the message-list payload: `MessageModel.query` resolves each
 * round's Work summaries and attaches them to the round's anchor message (keyed
 * by `metadata.work.rootOperationId`), so the in-message chips and the sidebar
 * summary read from one source instead of a dedicated work-summary fetch.
 */
describe('MessageModel · work summary attachment', () => {
  it("attaches a round's Work summaries to its anchor message", async () => {
    const taskModel = new TaskModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const messageModel = new MessageModel(serverDB, userId);

    const task = await taskModel.create({ instruction: 'Plan', name: 'Plan task' });

    await serverDB.insert(messages).values([
      {
        content: '',
        id: 'msg-assistant',
        // The anchor stamp the server keys the attachment by.
        metadata: { work: { rootOperationId: 'op-root' } },
        role: 'assistant',
        topicId,
        userId,
      },
      {
        content: '',
        id: 'msg-tool',
        parentId: 'msg-assistant',
        role: 'tool',
        topicId,
        userId,
      },
    ]);

    const work = await workModel.registerTask({
      changeType: 'created',
      rootOperationId: 'op-root',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
      messageId: 'msg-tool',
      toolCallId: 'tool-call-create',
      taskId: task.id,
      topicId,
    });

    const result = await messageModel.query({ topicId });

    const anchor = result.find((m) => m.id === 'msg-assistant');
    expect(anchor?.works).toHaveLength(1);
    expect(anchor?.works?.[0].id).toBe(work!.id);
    // Only the anchor carries the works — the tool row that shares the round does not.
    expect(result.find((m) => m.id === 'msg-tool')?.works).toBeUndefined();
  });

  it('omits works for messages that carry no work rootOperationId', async () => {
    const messageModel = new MessageModel(serverDB, userId);

    await serverDB.insert(messages).values({
      content: 'hi',
      id: 'msg-plain',
      role: 'user',
      topicId,
      userId,
    });

    const result = await messageModel.query({ topicId });
    expect(result.find((m) => m.id === 'msg-plain')?.works).toBeUndefined();
  });
});
