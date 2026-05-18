import { describe, expect, it } from 'vitest';

import type { Message, MessageGroupMetadata } from '../../types';
import { BranchResolver } from '../BranchResolver';
import { FlatListBuilder } from '../FlatListBuilder';
import { MessageCollector } from '../MessageCollector';
import { MessageTransformer } from '../MessageTransformer';

describe('FlatListBuilder', () => {
  const createBuilder = (
    messages: Message[],
    messageGroupMap: Map<string, MessageGroupMetadata> = new Map(),
  ) => {
    const messageMap = new Map<string, Message>();
    const childrenMap = new Map<string | null, string[]>();

    // Build maps
    messages.forEach((msg) => {
      messageMap.set(msg.id, msg);
      const parentId = msg.parentId || null;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(msg.id);
    });

    const branchResolver = new BranchResolver();
    const messageCollector = new MessageCollector(messageMap, childrenMap);
    const messageTransformer = new MessageTransformer();

    return new FlatListBuilder(
      messageMap,
      messageGroupMap,
      childrenMap,
      branchResolver,
      messageCollector,
      messageTransformer,
    );
  };

  describe('flatten', () => {
    it('should flatten simple message chain', () => {
      const messages: Message[] = [
        {
          content: 'Hello',
          createdAt: 0,
          id: 'msg-1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Hi',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
    });

    it('should create assistant group virtual message', () => {
      const messages: Message[] = [
        {
          content: 'Request',
          createdAt: 0,
          id: 'msg-1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Using tool',
          createdAt: 0,
          id: 'msg-2',
          metadata: { totalInputTokens: 10, totalOutputTokens: 20 },
          parentId: 'msg-1',
          role: 'assistant',
          tools: [
            { apiName: 'test', arguments: '{}', id: 'tool-1', identifier: 'test', type: 'default' },
          ],
          updatedAt: 0,
        },
        {
          content: 'Tool result',
          createdAt: 0,
          id: 'tool-1',
          parentId: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].role).toBe('assistantGroup');
      expect(result[1].children).toHaveLength(1);
      expect(result[1].usage).toBeDefined();
    });

    it('should handle user message with branches', () => {
      const messages: Message[] = [
        {
          content: 'User',
          createdAt: 0,
          id: 'msg-1',
          metadata: { activeBranchIndex: 0 },
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Branch 1',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'Branch 2',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2'); // active branch
    });

    it('should handle assistant message with branches', () => {
      const messages: Message[] = [
        {
          content: 'User',
          createdAt: 0,
          id: 'msg-1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Assistant',
          createdAt: 0,
          id: 'msg-2',
          metadata: { activeBranchIndex: 1 },
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'Branch 1',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Branch 2',
          createdAt: 0,
          id: 'msg-4',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
      expect(result[2].id).toBe('msg-4'); // active branch (index 1)
    });

    it('should create compare message from message group', () => {
      const messages: Message[] = [
        {
          content: 'Compare 1',
          createdAt: 0,
          groupId: 'group-1',
          id: 'msg-1',
          metadata: { activeColumn: true },
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'Compare 2',
          createdAt: 0,
          groupId: 'group-1',
          id: 'msg-2',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const messageGroupMap = new Map<string, MessageGroupMetadata>([
        ['group-1', { id: 'group-1', mode: 'compare' }],
      ]);

      const builder = createBuilder(messages, messageGroupMap);
      const result = builder.flatten(messages);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('group-1');
      expect(result[0].role).toBe('compare');
      expect((result[0] as any).columns).toHaveLength(2);
      expect((result[0] as any).activeColumnId).toBe('msg-1');
    });

    it('should create compare message from user metadata', () => {
      const messages: Message[] = [
        {
          content: 'User',
          createdAt: 0,
          id: 'msg-1',
          metadata: { compare: true },
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Assistant 1',
          createdAt: 0,
          id: 'msg-2',
          metadata: { activeColumn: true },
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'Assistant 2',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].role).toBe('compare');
      expect((result[1] as any).activeColumnId).toBe('msg-2');
    });

    it('should handle empty messages array', () => {
      const builder = createBuilder([]);
      const result = builder.flatten([]);

      expect(result).toHaveLength(0);
    });

    it('should follow active branch correctly', () => {
      const messages: Message[] = [
        {
          content: 'User',
          createdAt: 0,
          id: 'msg-1',
          metadata: { activeBranchIndex: 0 },
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Branch 1',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'Branch 2',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'Follow-up',
          createdAt: 0,
          id: 'msg-4',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
      expect(result[2].id).toBe('msg-4');
    });

    it('should handle assistant group in compare columns', () => {
      const messages: Message[] = [
        {
          content: 'User',
          createdAt: 0,
          id: 'msg-1',
          metadata: { compare: true },
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Assistant 1',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          tools: [
            { apiName: 'test', arguments: '{}', id: 'tool-1', identifier: 'test', type: 'default' },
          ],
          updatedAt: 0,
        },
        {
          content: 'Tool result',
          createdAt: 0,
          id: 'tool-1',
          parentId: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          updatedAt: 0,
        },
        {
          content: 'Assistant 2',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].role).toBe('compare');
      const columns = (result[1] as any).columns;
      expect(columns).toHaveLength(2);
      // First column should be an assistant group
      expect(columns[0][0].role).toBe('assistantGroup');
      // Second column should be a regular message
      expect(columns[1][0].id).toBe('msg-3');
    });

    it('should include follow-up messages after assistant chain', () => {
      const messages: Message[] = [
        {
          content: 'User request',
          createdAt: 0,
          id: 'msg-1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Using tool',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          tools: [
            { apiName: 'test', arguments: '{}', id: 'tool-1', identifier: 'test', type: 'default' },
          ],
          updatedAt: 0,
        },
        {
          content: 'Tool result',
          createdAt: 0,
          id: 'tool-1',
          parentId: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          updatedAt: 0,
        },
        {
          content: 'Response based on tool',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'tool-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'User follow-up',
          createdAt: 0,
          id: 'msg-4',
          parentId: 'msg-3',
          role: 'user',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // Critical: msg-4 should be included
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].role).toBe('assistantGroup');
      expect(result[2].id).toBe('msg-4');
    });

    it('should handle user reply to tool message', () => {
      const messages: Message[] = [
        {
          content: 'User request',
          createdAt: 0,
          id: 'msg-1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Using tool',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          tools: [
            { apiName: 'test', arguments: '{}', id: 'tool-1', identifier: 'test', type: 'default' },
          ],
          updatedAt: 0,
        },
        {
          content: 'Tool result',
          createdAt: 0,
          id: 'tool-1',
          parentId: 'msg-2',
          role: 'tool',
          tool_call_id: 'tool-1',
          updatedAt: 0,
        },
        {
          content: 'User reply to tool',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'tool-1',
          role: 'user',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // msg-3 should be included even though it's a reply to tool
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].role).toBe('assistantGroup');
      expect(result[2].id).toBe('msg-3');
    });

    it('should handle optimistic update for user message with branches', () => {
      // Scenario: User has sent a new message, activeBranchIndex points to a branch
      // that is being created but doesn't exist yet (optimistic update)
      const messages: Message[] = [
        {
          content: 'User',
          createdAt: 0,
          id: 'msg-1',
          // activeBranchIndex = 2 means pointing to a not-yet-created branch (optimistic update)
          // when there are only 2 existing children (msg-2, msg-3)
          metadata: { activeBranchIndex: 2 },
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Branch 1',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'Branch 2',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // When activeBranchIndex === children.length (optimistic update),
      // BranchResolver returns undefined, and FlatListBuilder just adds the user message
      // without branch info and doesn't continue to any branch
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-1');
      // User message should not have branch info since we're in optimistic update mode
      expect((result[0] as any).siblingCount).toBeUndefined();
    });

    it('should handle orphan messages where all have parentId (thread mode)', () => {
      // Scenario: Thread messages where the parent (source message) is not in the query result
      // All messages have parentId pointing to a message not in the array
      const messages: Message[] = [
        {
          content: 'Thread user message',
          createdAt: 0,
          id: 'msg-1',
          parentId: 'source-msg-not-in-array',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Thread assistant reply',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'Thread user follow-up',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-2',
          role: 'user',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // Should flatten all messages correctly using first message's parentId as virtual root
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');
      expect(result[2].id).toBe('msg-3');
    });

    it('should create tasks message when multiple tasks have same agentId', () => {
      const messages: Message[] = [
        {
          content: 'User request',
          createdAt: 0,
          id: 'msg-1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Tool message',
          createdAt: 0,
          id: 'tool-1',
          parentId: 'msg-1',
          role: 'tool',
          updatedAt: 0,
        },
        {
          agentId: 'agent-1',
          content: 'Task 1 result',
          createdAt: 1,
          id: 'task-1',
          parentId: 'tool-1',
          role: 'task',
          updatedAt: 1,
        },
        {
          agentId: 'agent-1',
          content: 'Task 2 result',
          createdAt: 2,
          id: 'task-2',
          parentId: 'tool-1',
          role: 'task',
          updatedAt: 2,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // Should create tasks (not groupTasks) since all tasks have same agentId
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('tool-1');
      expect(result[2].role).toBe('tasks');
      expect((result[2] as any).tasks).toHaveLength(2);
    });

    it('should create groupTasks message when multiple tasks have different agentIds', () => {
      const messages: Message[] = [
        {
          content: 'User request',
          createdAt: 0,
          id: 'msg-1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'Tool message',
          createdAt: 0,
          id: 'tool-1',
          parentId: 'msg-1',
          role: 'tool',
          updatedAt: 0,
        },
        {
          agentId: 'agent-1',
          content: 'Task 1 result',
          createdAt: 1,
          id: 'task-1',
          parentId: 'tool-1',
          role: 'task',
          updatedAt: 1,
        },
        {
          agentId: 'agent-2',
          content: 'Task 2 result',
          createdAt: 2,
          id: 'task-2',
          parentId: 'tool-1',
          role: 'task',
          updatedAt: 2,
        },
        {
          agentId: 'agent-3',
          content: 'Task 3 result',
          createdAt: 3,
          id: 'task-3',
          parentId: 'tool-1',
          role: 'task',
          updatedAt: 3,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // Should create groupTasks since tasks have different agentIds
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('tool-1');
      expect(result[2].role).toBe('groupTasks');
      expect((result[2] as any).tasks).toHaveLength(3);
      // Verify ID format
      expect(result[2].id).toContain('groupTasks-');
    });

    it('should create groupTasks with correct timestamps from task messages', () => {
      const messages: Message[] = [
        {
          content: 'Tool message',
          createdAt: 0,
          id: 'tool-1',
          role: 'tool',
          updatedAt: 0,
        },
        {
          agentId: 'agent-1',
          content: 'Task 1',
          createdAt: 100,
          id: 'task-1',
          parentId: 'tool-1',
          role: 'task',
          updatedAt: 150,
        },
        {
          agentId: 'agent-2',
          content: 'Task 2',
          createdAt: 200,
          id: 'task-2',
          parentId: 'tool-1',
          role: 'task',
          updatedAt: 300,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      const groupTasksMsg = result.find((m) => m.role === 'groupTasks');
      expect(groupTasksMsg).toBeDefined();
      // createdAt should be min of task createdAt
      expect(groupTasksMsg!.createdAt).toBe(100);
      // updatedAt should be max of task updatedAt
      expect(groupTasksMsg!.updatedAt).toBe(300);
    });
  });

  // ────────────────────────────────────────────────────
  // LOBE-8998: signal callbacks attached on virtual AssistantGroup
  // ────────────────────────────────────────────────────
  describe('signal callbacks (LOBE-8998)', () => {
    it('attaches signalCallbacks to the virtual group and processes callback messages', () => {
      const signalMeta = (sequence: number) =>
        ({
          signal: {
            sequence,
            sourceToolCallId: 'toolu_mon_0',
            sourceToolName: 'Monitor',
            type: 'tool-stdout' as const,
          },
        }) as any;

      const messages: Message[] = [
        // User
        { content: 'go', createdAt: 0, id: 'u-1', role: 'user', updatedAt: 0 },
        // Step 0: assistant with Monitor tool
        {
          agentId: 'a',
          content: 'starting',
          createdAt: 0,
          id: 'ast-0',
          parentId: 'u-1',
          role: 'assistant',
          tools: [
            {
              apiName: 'Monitor',
              arguments: '{}',
              id: 'toolu_mon_0',
              identifier: 'claude-code',
              type: 'default',
            },
          ],
          updatedAt: 0,
        },
        // Tool result
        {
          content: 'started',
          createdAt: 0,
          id: 'tool-1',
          parentId: 'ast-0',
          role: 'tool',
          tool_call_id: 'toolu_mon_0',
          updatedAt: 0,
        },
        // 3 signal callbacks under tool-1
        {
          agentId: 'a',
          content: '等 list 完。',
          createdAt: 0,
          id: 'cb-1',
          metadata: signalMeta(1),
          model: 'claude-opus-4-7',
          parentId: 'tool-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          agentId: 'a',
          content: '84842 列完，开干。',
          createdAt: 0,
          id: 'cb-2',
          metadata: signalMeta(2),
          model: 'claude-opus-4-7',
          parentId: 'tool-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          agentId: 'a',
          content: '100/84842 全 skip…',
          createdAt: 0,
          id: 'cb-3',
          metadata: signalMeta(3),
          model: 'claude-opus-4-7',
          parentId: 'tool-1',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // Expect: user msg + one assistantGroup virtual message. NO standalone
      // bubbles for cb-1/cb-2/cb-3 — they belong to the group.
      const ids = result.map((m) => m.id);
      expect(ids).not.toContain('cb-1');
      expect(ids).not.toContain('cb-2');
      expect(ids).not.toContain('cb-3');
      const group = result.find((m) => m.role === ('assistantGroup' as any));
      expect(group).toBeDefined();
      expect(group!.signalCallbacks).toHaveLength(1);
      const block = group!.signalCallbacks![0];
      expect(block).toMatchObject({
        sourceToolCallId: 'toolu_mon_0',
        sourceToolMessageId: 'tool-1',
        sourceToolName: 'Monitor',
      });
      expect(block.callbacks.map((c) => c.id)).toEqual(['cb-1', 'cb-2', 'cb-3']);
      expect(block.callbacks.map((c) => c.sequence)).toEqual([1, 2, 3]);
      expect(block.callbacks[0].content).toBe('等 list 完。');
    });
  });
});
