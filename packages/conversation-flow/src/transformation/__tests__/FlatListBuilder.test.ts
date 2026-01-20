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
      expect((result[0] as any).branch).toBeUndefined();
    });

    it('should handle nested branching (assistant with user children, where user has assistant children)', () => {
      // Scenario: U1 -> R1 -> U2_1/U2_2 -> R2_1/R2_2
      // U2_1 should be treated as having branches (R2_1, R2_2) in Priority 3d
      const messages: Message[] = [
        {
          content: 'U1',
          createdAt: 0,
          id: 'u1',
          metadata: { activeBranchIndex: 0 },
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'R1',
          createdAt: 0,
          id: 'r1',
          metadata: { activeBranchIndex: 0 },
          parentId: 'u1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'U2_1',
          createdAt: 0,
          id: 'u2_1',
          metadata: { activeBranchIndex: 0 },
          parentId: 'r1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'U2_2',
          createdAt: 0,
          id: 'u2_2',
          parentId: 'r1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'R2_1',
          createdAt: 0,
          id: 'r2_1',
          parentId: 'u2_1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'R2_2',
          createdAt: 0,
          id: 'r2_2',
          parentId: 'u2_1',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // Expected output:
      // Branch info indicates "this message has sibling branches"
      // 1. U1 (no branch info)
      // 2. R1 (no branch info on R1 itself)
      // 3. U2_1 with branch info { count: 2 } (indicating U2_1 has sibling U2_2)
      // 4. R2_1 with branch info { count: 2 } (indicating R2_1 has sibling R2_2)
      expect(result).toHaveLength(4);
      expect(result[0].id).toBe('u1');
      expect(result[1].id).toBe('r1');
      // R1 itself doesn't have branch info (branch info is on the active child U2_1)
      expect((result[1] as any).branch).toBeUndefined();
      expect(result[2].id).toBe('u2_1');
      // U2_1 has branch info indicating it has sibling U2_2
      expect((result[2] as any).branch).toEqual({ count: 2, activeBranchIndex: 0 });
      expect(result[3].id).toBe('r2_1');
      // R2_1 has branch info indicating it has sibling R2_2
      expect((result[3] as any).branch).toEqual({ count: 2, activeBranchIndex: 0 });
    });

    it('should handle deeply nested branching', () => {
      // Scenario with 3 levels of nesting:
      // U1 -> R1 -> U2 -> R2 -> U3_1/U3_2/U3_3
      const messages: Message[] = [
        {
          content: 'U1',
          createdAt: 0,
          id: 'u1',
          metadata: { activeBranchIndex: 0 },
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'R1',
          createdAt: 0,
          id: 'r1',
          metadata: { activeBranchIndex: 0 },
          parentId: 'u1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'U2',
          createdAt: 0,
          id: 'u2',
          metadata: { activeBranchIndex: 0 },
          parentId: 'r1',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'R2',
          createdAt: 0,
          id: 'r2',
          metadata: { activeBranchIndex: 0 },
          parentId: 'u2',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: 'U3_1',
          createdAt: 0,
          id: 'u3_1',
          metadata: { activeBranchIndex: 0 },
          parentId: 'r2',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'U3_2',
          createdAt: 0,
          id: 'u3_2',
          parentId: 'r2',
          role: 'user',
          updatedAt: 0,
        },
        {
          content: 'U3_3',
          createdAt: 0,
          id: 'u3_3',
          parentId: 'r2',
          role: 'user',
          updatedAt: 0,
        },
      ];

      const builder = createBuilder(messages);
      const result = builder.flatten(messages);

      // Expected: only R2 has multiple children (U3_1, U3_2, U3_3)
      // Branch info is attached to the active child U3_1
      expect(result).toHaveLength(5);
      expect(result[0].id).toBe('u1');
      expect(result[1].id).toBe('r1');
      expect(result[2].id).toBe('u2');
      expect(result[3].id).toBe('r2');
      // R2 itself doesn't have branch info
      expect((result[3] as any).branch).toBeUndefined();
      expect(result[4].id).toBe('u3_1');
      // U3_1 has branch info indicating it has siblings U3_2, U3_3
      expect((result[4] as any).branch).toEqual({ count: 3, activeBranchIndex: 0 });
    });

    describe('Mixed Priorities', () => {
      it('should handle AssistantGroup (Priority 2) followed by user branching (Priority 3d)', () => {
        // U1 -> R1 (AssistantGroup) -> Tool -> U2_1/U2_2 (branch)
        const messages: Message[] = [
          {
            content: 'U1',
            createdAt: 0,
            id: 'u1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'R1',
            createdAt: 0,
            id: 'r1',
            parentId: 'u1',
            role: 'assistant',
            tools: [{ apiName: 'test', arguments: '{}', id: 'tool-1', identifier: 'test', type: 'default' }],
            updatedAt: 0,
          },
          {
            content: 'Tool result',
            createdAt: 0,
            id: 'tool-1',
            parentId: 'r1',
            role: 'tool',
            tool_call_id: 'tool-1',
            updatedAt: 0,
          },
          {
            content: 'U2_1',
            createdAt: 0,
            id: 'u2_1',
            parentId: 'tool-1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'U2_2',
            createdAt: 0,
            id: 'u2_2',
            parentId: 'tool-1',
            role: 'user',
            updatedAt: 0,
          },
        ];

        const builder = createBuilder(messages);
        const result = builder.flatten(messages);

        // Expected: U1 -> assistantGroup -> U2_1 -> U2_2
        // Tool messages don't participate in branching, so all replies are included
        expect(result).toHaveLength(4);
        expect(result[0].id).toBe('u1');
        expect(result[0].role).toBe('user');
        expect((result[0] as any).branch).toBeUndefined();
        expect(result[1].role).toBe('assistantGroup');
        expect((result[1] as any).branch).toBeUndefined();
        expect(result[2].id).toBe('u2_1');
        expect(result[2].role).toBe('user');
        expect((result[2] as any).branch).toBeUndefined();
        expect(result[3].id).toBe('u2_2');
        expect(result[3].role).toBe('user');
        expect((result[3] as any).branch).toBeUndefined();
      });

      it('should handle branching (Priority 3e) followed by AssistantGroup (Priority 2)', () => {
        // U1 -> R1 (branch) -> U2_1/U2_2 -> U2_1 -> R2 (AssistantGroup)
        const messages: Message[] = [
          {
            content: 'U1',
            createdAt: 0,
            id: 'u1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'R1',
            createdAt: 0,
            id: 'r1',
            metadata: { activeBranchIndex: 0 },
            parentId: 'u1',
            role: 'assistant',
            updatedAt: 0,
          },
          {
            content: 'U2_1',
            createdAt: 0,
            id: 'u2_1',
            parentId: 'r1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'U2_2',
            createdAt: 0,
            id: 'u2_2',
            parentId: 'r1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'R2',
            createdAt: 0,
            id: 'r2',
            parentId: 'u2_1',
            role: 'assistant',
            tools: [{ apiName: 'test', arguments: '{}', id: 'tool-2', identifier: 'test', type: 'default' }],
            updatedAt: 0,
          },
          {
            content: 'Tool result 2',
            createdAt: 0,
            id: 'tool-2',
            parentId: 'r2',
            role: 'tool',
            tool_call_id: 'tool-2',
            updatedAt: 0,
          },
          {
            content: 'U3',
            createdAt: 0,
            id: 'u3',
            parentId: 'tool-2',
            role: 'user',
            updatedAt: 0,
          },
        ];

        const builder = createBuilder(messages);
        const result = builder.flatten(messages);

        // Expected: U1 -> R1 -> U2_1 (with branch info from R1's children) -> assistantGroup -> U3
        // Branch info on U2_1 indicates U2_1 has sibling U2_2
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].id).toBe('u1');
        expect(result[1].id).toBe('r1');
        // R1 itself doesn't have branch info
        expect((result[1] as any).branch).toBeUndefined();
        expect(result[2].id).toBe('u2_1');
        // U2_1 has branch info from R1's children (U2_1, U2_2)
        expect((result[2] as any).branch).toEqual({ count: 2, activeBranchIndex: 0 });
      });

      it('should handle Compare group (Priority 1) followed by user branching (Priority 3d)', () => {
        // U1 (compare mode) -> R1/R2 (columns) -> R1 (active) -> U2_1/U2_2 (branch)
        const messages: Message[] = [
          {
            content: 'U1',
            createdAt: 0,
            id: 'u1',
            metadata: { compare: true },
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'R1',
            createdAt: 0,
            id: 'r1',
            metadata: { activeColumn: true },
            parentId: 'u1',
            role: 'assistant',
            updatedAt: 0,
          },
          {
            content: 'R2',
            createdAt: 0,
            id: 'r2',
            parentId: 'u1',
            role: 'assistant',
            updatedAt: 0,
          },
          {
            content: 'U2_1',
            createdAt: 0,
            id: 'u2_1',
            parentId: 'r1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'U2_2',
            createdAt: 0,
            id: 'u2_2',
            parentId: 'r1',
            role: 'user',
            updatedAt: 0,
          },
        ];

        const builder = createBuilder(messages);
        const result = builder.flatten(messages);

        // Expected: U1 -> compare (R1, R2) -> U2_1, U2_2 (from active column R1)
        // Note: U2_1, U2_2 don't have metadata to trigger branching, so they're added as regular messages
        expect(result).toHaveLength(4);
        expect(result[0].id).toBe('u1');
        expect(result[0].role).toBe('user');
        expect((result[0] as any).branch).toBeUndefined();
        expect(result[1].role).toBe('compare');
        expect((result[1] as any).activeColumnId).toBe('r1');
        expect((result[1] as any).branch).toBeUndefined();
        expect(result[2].id).toBe('u2_1');
        expect(result[2].role).toBe('user');
        expect((result[2] as any).branch).toBeUndefined();
        expect(result[3].id).toBe('u2_2');
        expect(result[3].role).toBe('user');
        expect((result[3] as any).branch).toBeUndefined();
      });

      it('should handle user branching (Priority 3d) followed by Compare group (Priority 1)', () => {
        // U1 -> R1 (branch) -> U2_1/U2_2 -> U2_1 -> R2_1/R2_2 (compare group)
        const messages: Message[] = [
          {
            content: 'U1',
            createdAt: 0,
            id: 'u1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'R1',
            createdAt: 0,
            id: 'r1',
            parentId: 'u1',
            role: 'assistant',
            updatedAt: 0,
          },
          {
            content: 'U2_1',
            createdAt: 0,
            id: 'u2_1',
            parentId: 'r1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'U2_2',
            createdAt: 0,
            id: 'u2_2',
            parentId: 'r1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'R2_1',
            createdAt: 0,
            id: 'r2_1',
            groupId: 'compare-1',
            metadata: { activeColumn: true },
            parentId: 'u2_1',
            role: 'assistant',
            updatedAt: 0,
          },
          {
            content: 'R2_2',
            createdAt: 0,
            id: 'r2_2',
            groupId: 'compare-1',
            parentId: 'u2_1',
            role: 'assistant',
            updatedAt: 0,
          },
        ];

        const messageGroupMap = new Map<string, MessageGroupMetadata>([
          ['compare-1', { id: 'compare-1', mode: 'compare', parentMessageId: 'u2_1' }],
        ]);

        const builder = createBuilder(messages, messageGroupMap);
        const result = builder.flatten(messages);

        // Expected: U1 -> R1 -> U2_1 (branch) -> R2_1 (branch) -> compare (R2_1, R2_2)
        expect(result).toHaveLength(5);
        expect(result[0].id).toBe('u1');
        expect(result[0].role).toBe('user');
        expect((result[0] as any).branch).toBeUndefined();
        expect(result[1].id).toBe('r1');
        expect(result[1].role).toBe('assistant');
        expect((result[1] as any).branch).toBeUndefined();
        expect(result[2].id).toBe('u2_1');
        expect(result[2].role).toBe('user');
        expect((result[2] as any).branch).toEqual({ count: 2, activeBranchIndex: 0 });
        expect(result[3].id).toBe('r2_1');
        expect(result[3].role).toBe('assistant');
        expect((result[3] as any).branch).toEqual({ count: 2, activeBranchIndex: 0 });
        expect(result[4].role).toBe('compare');
        expect((result[4] as any).branch).toBeUndefined();
      });

      it('should handle complex mixed scenario: AssistantGroup -> Branch -> Compare', () => {
        // U1 -> R1 (AssistantGroup) -> Tool -> U2_1/U2_2 (branch) -> U2_1 -> R2_1/R2_2 (compare)
        const messages: Message[] = [
          {
            content: 'U1',
            createdAt: 0,
            id: 'u1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'R1',
            createdAt: 0,
            id: 'r1',
            parentId: 'u1',
            role: 'assistant',
            tools: [{ apiName: 'test', arguments: '{}', id: 'tool-1', identifier: 'test', type: 'default' }],
            updatedAt: 0,
          },
          {
            content: 'Tool result',
            createdAt: 0,
            id: 'tool-1',
            parentId: 'r1',
            role: 'tool',
            tool_call_id: 'tool-1',
            updatedAt: 0,
          },
          {
            content: 'U2_1',
            createdAt: 0,
            id: 'u2_1',
            parentId: 'tool-1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'U2_2',
            createdAt: 0,
            id: 'u2_2',
            parentId: 'tool-1',
            role: 'user',
            updatedAt: 0,
          },
          {
            content: 'R2_1',
            createdAt: 0,
            id: 'r2_1',
            groupId: 'compare-1',
            metadata: { activeColumn: true },
            parentId: 'u2_1',
            role: 'assistant',
            updatedAt: 0,
          },
          {
            content: 'R2_2',
            createdAt: 0,
            id: 'r2_2',
            groupId: 'compare-1',
            parentId: 'u2_1',
            role: 'assistant',
            updatedAt: 0,
          },
        ];

        const messageGroupMap = new Map<string, MessageGroupMetadata>([
          ['compare-1', { id: 'compare-1', mode: 'compare', parentMessageId: 'u2_1' }],
        ]);

        const builder = createBuilder(messages, messageGroupMap);
        const result = builder.flatten(messages);

        // Expected: U1 -> assistantGroup -> U2_1 -> R2_1 -> compare (R2_1, R2_2) -> U2_2
        // Note: U2_1 doesn't have metadata for branching, and R2_1/R2_2 don't have children,
        // so BranchResolver defaults to first child (R2_1) as active
        expect(result).toHaveLength(6);
        expect(result[0].id).toBe('u1');
        expect(result[0].role).toBe('user');
        expect((result[0] as any).branch).toBeUndefined();
        expect(result[1].role).toBe('assistantGroup');
        expect((result[1] as any).branch).toBeUndefined();
        expect(result[2].id).toBe('u2_1');
        expect(result[2].role).toBe('user');
        expect((result[2] as any).branch).toBeUndefined();
        expect(result[3].id).toBe('r2_1');
        expect(result[3].role).toBe('assistant');
        expect((result[3] as any).branch).toEqual({ count: 2, activeBranchIndex: 0 });
        expect(result[4].role).toBe('compare');
        expect((result[4] as any).branch).toBeUndefined();
        expect(result[5].id).toBe('u2_2');
        expect(result[5].role).toBe('user');
        expect((result[5] as any).branch).toBeUndefined();
      });
    });
  });
});
