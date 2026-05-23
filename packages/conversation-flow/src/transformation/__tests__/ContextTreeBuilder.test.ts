import { describe, expect, it } from 'vitest';

import type { IdNode, Message, MessageGroupMetadata } from '../../types';
import { BranchResolver } from '../BranchResolver';
import { ContextTreeBuilder } from '../ContextTreeBuilder';
import { MessageCollector } from '../MessageCollector';

describe('ContextTreeBuilder', () => {
  const createBuilder = (
    messageMap: Map<string, Message>,
    messageGroupMap: Map<string, MessageGroupMetadata> = new Map(),
  ) => {
    const childrenMap = new Map<string | null, string[]>();
    const branchResolver = new BranchResolver();
    const messageCollector = new MessageCollector(messageMap, childrenMap);
    let nodeIdCounter = 0;
    const generateNodeId = (prefix: string, messageId: string) =>
      `${prefix}-${messageId}-${nodeIdCounter++}`;

    return new ContextTreeBuilder(
      messageMap,
      messageGroupMap,
      branchResolver,
      messageCollector,
      generateNodeId,
    );
  };

  describe('transformAll', () => {
    it('should transform regular message nodes', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'Hello',
            createdAt: 0,
            id: 'msg-1',
            role: 'user',
            updatedAt: 0,
          },
        ],
        [
          'msg-2',
          {
            content: 'Hi',
            createdAt: 0,
            id: 'msg-2',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
      ]);

      const builder = createBuilder(messageMap);
      const idNodes: IdNode[] = [
        {
          children: [{ children: [], id: 'msg-2' }],
          id: 'msg-1',
        },
      ];

      const result = builder.transformAll(idNodes);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'msg-1', type: 'message' });
      expect(result[1]).toEqual({ id: 'msg-2', type: 'message' });
    });

    it('should create branch node for multiple children', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'Hello',
            createdAt: 0,
            id: 'msg-1',
            metadata: { activeBranchIndex: 0 },
            role: 'user',
            updatedAt: 0,
          },
        ],
        [
          'msg-2',
          {
            content: 'Response 1',
            createdAt: 0,
            id: 'msg-2',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'msg-3',
          {
            content: 'Response 2',
            createdAt: 0,
            id: 'msg-3',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
      ]);

      const builder = createBuilder(messageMap);
      const idNodes: IdNode[] = [
        {
          children: [
            { children: [], id: 'msg-2' },
            { children: [], id: 'msg-3' },
          ],
          id: 'msg-1',
        },
      ];

      const result = builder.transformAll(idNodes);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'msg-1', type: 'message' });
      expect(result[1]).toMatchObject({
        activeBranchIndex: 0,
        branches: [[{ id: 'msg-2', type: 'message' }], [{ id: 'msg-3', type: 'message' }]],
        parentMessageId: 'msg-1',
        type: 'branch',
      });
    });

    it('should create assistant group node for assistant with tools', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'Assistant with tools',
            createdAt: 0,
            id: 'msg-1',
            role: 'assistant',
            tools: [
              {
                apiName: 'test',
                arguments: '{}',
                id: 'tool-1',
                identifier: 'test',
                type: 'default',
              },
            ],
            updatedAt: 0,
          },
        ],
        [
          'tool-1',
          {
            content: 'Tool result',
            createdAt: 0,
            id: 'tool-1',
            role: 'tool',
            updatedAt: 0,
          },
        ],
      ]);

      const builder = createBuilder(messageMap);
      const idNodes: IdNode[] = [
        {
          children: [{ children: [], id: 'tool-1' }],
          id: 'msg-1',
        },
      ];

      const result = builder.transformAll(idNodes);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        children: [{ id: 'msg-1', tools: ['tool-1'], type: 'message' }],
        id: 'msg-1',
        type: 'assistantGroup',
      });
    });

    it('should create compare node from message group', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'Compare 1',
            createdAt: 0,
            groupId: 'group-1',
            id: 'msg-1',
            metadata: { activeColumn: true },
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'msg-2',
          {
            content: 'Compare 2',
            createdAt: 0,
            groupId: 'group-1',
            id: 'msg-2',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
      ]);

      const messageGroupMap = new Map<string, MessageGroupMetadata>([
        ['group-1', { id: 'group-1', mode: 'compare' }],
      ]);

      const builder = createBuilder(messageMap, messageGroupMap);
      const idNodes: IdNode[] = [{ children: [], id: 'msg-1' }];

      const result = builder.transformAll(idNodes);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        activeColumnId: 'msg-1',
        columns: [[{ id: 'msg-1', type: 'message' }], [{ id: 'msg-2', type: 'message' }]],
        messageId: 'msg-1',
        type: 'compare',
      });
    });

    it('should create compare node from user message metadata', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'User message',
            createdAt: 0,
            id: 'msg-1',
            metadata: { compare: true },
            role: 'user',
            updatedAt: 0,
          },
        ],
        [
          'msg-2',
          {
            content: 'Assistant 1',
            createdAt: 0,
            id: 'msg-2',
            metadata: { activeColumn: true },
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'msg-3',
          {
            content: 'Assistant 2',
            createdAt: 0,
            id: 'msg-3',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
      ]);

      const builder = createBuilder(messageMap);
      const idNodes: IdNode[] = [
        {
          children: [
            { children: [], id: 'msg-2' },
            { children: [], id: 'msg-3' },
          ],
          id: 'msg-1',
        },
      ];

      const result = builder.transformAll(idNodes);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'msg-1', type: 'message' });
      expect(result[1]).toMatchObject({
        activeColumnId: 'msg-2',
        columns: [[{ id: 'msg-2', type: 'message' }], [{ id: 'msg-3', type: 'message' }]],
        id: 'compare-msg-1-msg-2-msg-3',
        messageId: 'msg-1',
        type: 'compare',
      });
    });

    it('should handle empty node list', () => {
      const messageMap = new Map<string, Message>();
      const builder = createBuilder(messageMap);

      const result = builder.transformAll([]);

      expect(result).toHaveLength(0);
    });

    it('should handle missing message in map', () => {
      const messageMap = new Map<string, Message>();
      const builder = createBuilder(messageMap);
      const idNodes: IdNode[] = [{ children: [], id: 'missing' }];

      const result = builder.transformAll(idNodes);

      expect(result).toHaveLength(0);
    });

    it('should set activeBranchIndex to children.length for optimistic update', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'Hello',
            createdAt: 0,
            id: 'msg-1',
            // activeBranchIndex = 2 means optimistic update (pointing to not-yet-created branch)
            metadata: { activeBranchIndex: 2 },
            role: 'user',
            updatedAt: 0,
          },
        ],
        [
          'msg-2',
          {
            content: 'Response 1',
            createdAt: 0,
            id: 'msg-2',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'msg-3',
          {
            content: 'Response 2',
            createdAt: 0,
            id: 'msg-3',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
      ]);

      const builder = createBuilder(messageMap);
      const idNodes: IdNode[] = [
        {
          children: [
            { children: [], id: 'msg-2' },
            { children: [], id: 'msg-3' },
          ],
          id: 'msg-1',
        },
      ];

      const result = builder.transformAll(idNodes);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 'msg-1', type: 'message' });
      // When activeBranchIndex === children.length (optimistic update),
      // BranchResolver returns undefined, and ContextTreeBuilder uses children.length as index
      expect(result[1]).toMatchObject({
        activeBranchIndex: 2, // children.length = 2
        branches: [[{ id: 'msg-2', type: 'message' }], [{ id: 'msg-3', type: 'message' }]],
        parentMessageId: 'msg-1',
        type: 'branch',
      });
    });

    it('should continue with active column children in compare mode', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'User',
            createdAt: 0,
            id: 'msg-1',
            metadata: { compare: true },
            role: 'user',
            updatedAt: 0,
          },
        ],
        [
          'msg-2',
          {
            content: 'Assistant 1',
            createdAt: 0,
            id: 'msg-2',
            metadata: { activeColumn: true },
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'msg-3',
          {
            content: 'Assistant 2',
            createdAt: 0,
            id: 'msg-3',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'msg-4',
          {
            content: 'Follow-up',
            createdAt: 0,
            id: 'msg-4',
            role: 'user',
            updatedAt: 0,
          },
        ],
      ]);

      const builder = createBuilder(messageMap);
      const idNodes: IdNode[] = [
        {
          children: [
            { children: [{ children: [], id: 'msg-4' }], id: 'msg-2' },
            { children: [], id: 'msg-3' },
          ],
          id: 'msg-1',
        },
      ];

      const result = builder.transformAll(idNodes);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 'msg-1', type: 'message' });
      expect(result[1]).toMatchObject({
        type: 'compare',
      });
      expect(result[2]).toEqual({ id: 'msg-4', type: 'message' });
    });
  });

  // ────────────────────────────────────────────────────
  // LOBE-8998: AssistantGroupNode embeds SignalCallbacksNode children
  // ────────────────────────────────────────────────────
  describe('AssistantGroup with signal callbacks (LOBE-8998)', () => {
    it('appends SignalCallbacksNode at the end of AssistantGroup children', () => {
      const signalMeta = (sequence: number) => ({
        signal: {
          sequence,
          sourceToolCallId: 'toolu_mon',
          sourceToolName: 'Monitor',
          type: 'tool-stdout' as const,
        },
      });

      const messageMap = new Map<string, Message>([
        [
          'ast-0',
          {
            agentId: 'agent-x',
            content: '',
            createdAt: 0,
            id: 'ast-0',
            role: 'assistant',
            tools: [
              {
                apiName: 'Monitor',
                arguments: '{}',
                id: 'toolu_mon',
                identifier: 'claude-code',
                type: 'default',
              },
            ],
            updatedAt: 0,
          },
        ],
        [
          'tool-1',
          {
            content: 'started',
            createdAt: 0,
            id: 'tool-1',
            parentId: 'ast-0',
            role: 'tool',
            tool_call_id: 'toolu_mon',
            updatedAt: 0,
          },
        ],
        [
          'cb-1',
          {
            agentId: 'agent-x',
            content: '等 list 完。',
            createdAt: 0,
            id: 'cb-1',
            metadata: signalMeta(1) as any,
            parentId: 'tool-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'cb-2',
          {
            agentId: 'agent-x',
            content: '84842 列完，开干。',
            createdAt: 0,
            id: 'cb-2',
            metadata: signalMeta(2) as any,
            parentId: 'tool-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'ast-4',
          {
            agentId: 'agent-x',
            content: '',
            createdAt: 0,
            id: 'ast-4',
            parentId: 'tool-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
      ]);

      const builder = createBuilder(messageMap);
      const idNodes: IdNode[] = [
        {
          children: [
            {
              children: [
                { children: [], id: 'cb-1' },
                { children: [], id: 'cb-2' },
                { children: [], id: 'ast-4' },
              ],
              id: 'tool-1',
            },
          ],
          id: 'ast-0',
        },
      ];

      const result = builder.transformAll(idNodes);
      // One AssistantGroup node at the top
      expect(result).toHaveLength(1);
      const group = result[0] as any;
      expect(group.type).toBe('assistantGroup');

      // Main chain assistants then signalCallbacks block at the end
      expect(group.children.map((c: any) => c.type)).toEqual([
        'message', // ast-0
        'message', // ast-4
        'signalCallbacks',
      ]);
      expect(group.children[0].id).toBe('ast-0');
      expect(group.children[0].tools).toEqual(['tool-1']);
      expect(group.children[1].id).toBe('ast-4');
      expect(group.children[2]).toMatchObject({
        sourceToolCallId: 'toolu_mon',
        sourceToolMessageId: 'tool-1',
        sourceToolName: 'Monitor',
        type: 'signalCallbacks',
      });
      expect(group.children[2].callbacks.map((c: any) => c.id)).toEqual(['cb-1', 'cb-2']);
    });
  });
});
