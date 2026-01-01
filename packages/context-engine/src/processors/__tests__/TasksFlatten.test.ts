import { describe, expect, it } from 'vitest';

import { TasksFlattenProcessor } from '../TasksFlatten';

describe('TasksFlattenProcessor', () => {
  it('should flatten tasks message into individual task messages', async () => {
    const processor = new TasksFlattenProcessor();

    const context = {
      messages: [
        {
          content: 'Hello',
          id: 'msg-1',
          role: 'user',
        },
        {
          id: 'tasks-1',
          role: 'tasks',
          tasks: [
            {
              content: 'Task 1 result',
              id: 'task-1',
              metadata: { instruction: 'Do task 1' },
              role: 'task',
            },
            {
              content: 'Task 2 result',
              id: 'task-2',
              metadata: { instruction: 'Do task 2' },
              role: 'task',
            },
          ],
        },
      ],
      metadata: {},
      stats: { startTime: Date.now() },
    };

    const result = await processor.process(context as any);

    // Should have 3 messages: 1 user + 2 flattened tasks
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('task');
    expect(result.messages[1].id).toBe('task-1');
    expect(result.messages[2].role).toBe('task');
    expect(result.messages[2].id).toBe('task-2');
  });

  it('should skip empty tasks array', async () => {
    const processor = new TasksFlattenProcessor();

    const context = {
      messages: [
        {
          content: 'Hello',
          id: 'msg-1',
          role: 'user',
        },
        {
          id: 'tasks-1',
          role: 'tasks',
          tasks: [],
        },
      ],
      metadata: {},
      stats: { startTime: Date.now() },
    };

    const result = await processor.process(context as any);

    // Should only have user message, empty tasks should be skipped
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('should preserve parent message references', async () => {
    const processor = new TasksFlattenProcessor();

    const context = {
      messages: [
        {
          groupId: 'group-1',
          id: 'tasks-1',
          parentId: 'parent-1',
          role: 'tasks',
          tasks: [
            {
              content: 'Task result',
              id: 'task-1',
              role: 'task',
            },
          ],
          threadId: 'thread-1',
          topicId: 'topic-1',
        },
      ],
      metadata: {},
      stats: { startTime: Date.now() },
    };

    const result = await processor.process(context as any);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].parentId).toBe('parent-1');
    expect(result.messages[0].threadId).toBe('thread-1');
    expect(result.messages[0].groupId).toBe('group-1');
    expect(result.messages[0].topicId).toBe('topic-1');
  });

  it('should not override existing task references', async () => {
    const processor = new TasksFlattenProcessor();

    const context = {
      messages: [
        {
          id: 'tasks-1',
          parentId: 'parent-1',
          role: 'tasks',
          tasks: [
            {
              content: 'Task result',
              id: 'task-1',
              parentId: 'task-parent-1', // Task has its own parentId
              role: 'task',
            },
          ],
        },
      ],
      metadata: {},
      stats: { startTime: Date.now() },
    };

    const result = await processor.process(context as any);

    // Task's own parentId should be preserved
    expect(result.messages[0].parentId).toBe('task-parent-1');
  });

  it('should pass through non-tasks messages unchanged', async () => {
    const processor = new TasksFlattenProcessor();

    const context = {
      messages: [
        {
          content: 'Hello',
          id: 'msg-1',
          role: 'user',
        },
        {
          content: 'Hi there',
          id: 'msg-2',
          role: 'assistant',
        },
      ],
      metadata: {},
      stats: { startTime: Date.now() },
    };

    const result = await processor.process(context as any);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(context.messages[0]);
    expect(result.messages[1]).toEqual(context.messages[1]);
  });

  it('should update metadata with processing counts', async () => {
    const processor = new TasksFlattenProcessor();

    const context = {
      messages: [
        {
          id: 'tasks-1',
          role: 'tasks',
          tasks: [
            { content: 'Task 1', id: 'task-1', role: 'task' },
            { content: 'Task 2', id: 'task-2', role: 'task' },
          ],
        },
      ],
      metadata: {},
      stats: { startTime: Date.now() },
    };

    const result = await processor.process(context as any);

    expect(result.metadata.tasksFlattenProcessed).toBe(1);
    expect(result.metadata.tasksMessagesFlattened).toBe(1);
    expect(result.metadata.taskMessagesCreated).toBe(2);
  });
});
