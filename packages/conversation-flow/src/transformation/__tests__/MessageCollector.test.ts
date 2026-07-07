import { describe, expect, it } from 'vitest';

import type { IdNode, Message } from '../../types';
import { MessageCollector } from '../MessageCollector';

describe('MessageCollector', () => {
  describe('collectGroupMembers', () => {
    it('should collect messages with matching groupId', () => {
      const messageMap = new Map<string, Message>();
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const messages: Message[] = [
        {
          content: '1',
          createdAt: 0,
          groupId: 'group-1',
          id: 'msg-1',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: '2',
          createdAt: 0,
          groupId: 'group-1',
          id: 'msg-2',
          role: 'assistant',
          updatedAt: 0,
        },
        {
          content: '3',
          createdAt: 0,
          groupId: 'group-2',
          id: 'msg-3',
          role: 'assistant',
          updatedAt: 0,
        },
      ];

      const result = collector.collectGroupMembers('group-1', messages);

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
    });
  });

  describe('collectToolMessages', () => {
    it('should collect tool messages matching assistant tool call IDs', () => {
      const messageMap = new Map<string, Message>();
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const assistant: Message = {
        content: 'test',
        createdAt: 0,
        id: 'msg-1',
        role: 'assistant',
        tools: [
          { apiName: 'tool1', arguments: '{}', id: 'tool-1', identifier: 'test', type: 'default' },
          { apiName: 'tool2', arguments: '{}', id: 'tool-2', identifier: 'test', type: 'default' },
        ],
        updatedAt: 0,
      };

      const messages: Message[] = [
        {
          content: 'result1',
          createdAt: 0,
          id: 'msg-2',
          parentId: 'msg-1',
          role: 'tool',
          tool_call_id: 'tool-1',
          updatedAt: 0,
        },
        {
          content: 'result2',
          createdAt: 0,
          id: 'msg-3',
          parentId: 'msg-1',
          role: 'tool',
          tool_call_id: 'tool-2',
          updatedAt: 0,
        },
        {
          content: 'other',
          createdAt: 0,
          id: 'msg-4',
          parentId: 'msg-1',
          role: 'tool',
          tool_call_id: 'tool-3',
          updatedAt: 0,
        },
      ];

      const result = collector.collectToolMessages(assistant, messages);

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['msg-2', 'msg-3']);
    });

    it('should prefer result_msg_id when tool call IDs repeat in the same topic', () => {
      const messageMap = new Map<string, Message>();
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const assistant: Message = {
        content: 'current turn',
        createdAt: 0,
        id: 'assistant-current',
        role: 'assistant',
        tools: [
          {
            apiName: 'command_execution',
            arguments: '{}',
            id: 'item_1',
            identifier: 'codex',
            result_msg_id: 'tool-current',
            type: 'default',
          },
        ],
        updatedAt: 0,
      };

      const messages: Message[] = [
        {
          content: 'older result with the same Codex item id',
          createdAt: 0,
          id: 'tool-old',
          parentId: 'assistant-old',
          role: 'tool',
          tool_call_id: 'item_1',
          updatedAt: 0,
        },
        {
          content: 'current result',
          createdAt: 0,
          id: 'tool-current',
          parentId: 'assistant-current',
          role: 'tool',
          tool_call_id: 'item_1',
          updatedAt: 0,
        },
      ];

      const result = collector.collectToolMessages(assistant, messages);

      expect(result.map((m) => m.id)).toEqual(['tool-current']);
    });

    it('should fall back to parent-scoped tool_call_id matching for older tool payloads', () => {
      const messageMap = new Map<string, Message>();
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const assistant: Message = {
        content: 'current turn',
        createdAt: 0,
        id: 'assistant-current',
        role: 'assistant',
        tools: [
          {
            apiName: 'command_execution',
            arguments: '{}',
            id: 'item_1',
            identifier: 'codex',
            type: 'default',
          },
        ],
        updatedAt: 0,
      };

      const messages: Message[] = [
        {
          content: 'older result with the same Codex item id',
          createdAt: 0,
          id: 'tool-old',
          parentId: 'assistant-old',
          role: 'tool',
          tool_call_id: 'item_1',
          updatedAt: 0,
        },
        {
          content: 'current result',
          createdAt: 0,
          id: 'tool-current',
          parentId: 'assistant-current',
          role: 'tool',
          tool_call_id: 'item_1',
          updatedAt: 0,
        },
      ];

      const result = collector.collectToolMessages(assistant, messages);

      expect(result.map((m) => m.id)).toEqual(['tool-current']);
    });
  });

  describe('findLastNodeInAssistantGroup', () => {
    it('should return the node itself if no tool children', () => {
      const messageMap = new Map<string, Message>();
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const idNode: IdNode = {
        children: [],
        id: 'msg-1',
      };

      const result = collector.findLastNodeInAssistantGroup(idNode);

      expect(result).toEqual(idNode);
    });

    it('should return last tool node if no assistant children', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'test',
            createdAt: 0,
            id: 'msg-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'tool-1',
          {
            content: 'result',
            createdAt: 0,
            id: 'tool-1',
            parentId: 'msg-1',
            role: 'tool',
            updatedAt: 0,
          },
        ],
      ]);
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const idNode: IdNode = {
        children: [{ children: [], id: 'tool-1' }],
        id: 'msg-1',
      };

      const result = collector.findLastNodeInAssistantGroup(idNode);

      expect(result?.id).toBe('tool-1');
    });

    it('should follow assistant chain recursively', () => {
      const messageMap = new Map<string, Message>([
        [
          'msg-1',
          {
            content: 'test1',
            createdAt: 0,
            id: 'msg-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'tool-1',
          {
            content: 'result1',
            createdAt: 0,
            id: 'tool-1',
            parentId: 'msg-1',
            role: 'tool',
            updatedAt: 0,
          },
        ],
        [
          'msg-2',
          {
            content: 'test2',
            createdAt: 0,
            id: 'msg-2',
            parentId: 'tool-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
      ]);
      const childrenMap = new Map<string | null, string[]>();
      const collector = new MessageCollector(messageMap, childrenMap);

      const idNode: IdNode = {
        children: [
          {
            children: [{ children: [], id: 'msg-2' }],
            id: 'tool-1',
          },
        ],
        id: 'msg-1',
      };

      const result = collector.findLastNodeInAssistantGroup(idNode);

      expect(result?.id).toBe('msg-2');
    });

    it('skips signal-tagged callbacks when locating the group tail', () => {
      // when [signal callback, next tool-using assistant]
      // both live under the same tool, the tail finder must follow the
      // real main-chain assistant — taking children[0] blindly lands on
      // the callback (which is a leaf) and truncates the AssistantGroup.
      const messageMap = new Map<string, Message>([
        [
          'ast-0',
          {
            agentId: 'agent-x',
            content: '',
            createdAt: 0,
            id: 'ast-0',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'tool-1',
          {
            content: '',
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
            content: '',
            createdAt: 0,
            id: 'cb-1',
            metadata: {
              signal: {
                sequence: 1,
                sourceToolCallId: 'toolu_mon',
                sourceToolName: 'Monitor',
                type: 'tool-stdout',
              },
            } as any,
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
        [
          'tool-2',
          {
            content: '',
            createdAt: 0,
            id: 'tool-2',
            parentId: 'ast-4',
            role: 'tool',
            updatedAt: 0,
          },
        ],
      ]);
      const collector = new MessageCollector(messageMap, new Map());

      const idNode: IdNode = {
        children: [
          {
            children: [
              { children: [], id: 'cb-1' },
              {
                children: [{ children: [], id: 'tool-2' }],
                id: 'ast-4',
              },
            ],
            id: 'tool-1',
          },
        ],
        id: 'ast-0',
      };

      const result = collector.findLastNodeInAssistantGroup(idNode, 'agent-x');

      // Tail must be tool-2 (descended through ast-4), NOT cb-1.
      expect(result?.id).toBe('tool-2');
    });
  });

  // ────────────────────────────────────────────────────
  // external signal callback collection
  // ────────────────────────────────────────────────────
  describe('collectSignalCallbacks', () => {
    const mkAssistant = (id: string, opts?: Partial<Message>): Message => ({
      agentId: 'agent-x',
      content: '',
      createdAt: 0,
      id,
      role: 'assistant',
      updatedAt: 0,
      ...opts,
    });
    const mkTool = (id: string, opts?: Partial<Message>): Message => ({
      content: '',
      createdAt: 0,
      id,
      role: 'tool',
      updatedAt: 0,
      ...opts,
    });
    const mkSignalCallback = (id: string, sourceToolCallId: string, sequence: number): Message =>
      mkAssistant(id, {
        metadata: {
          signal: {
            sequence,
            sourceToolCallId,
            sourceToolName: 'Monitor',
            type: 'tool-stdout',
          },
        } as any,
      });

    it('groups toolless signal-tagged children under one block per source tool', () => {
      const messageMap = new Map<string, Message>([
        ['ast-0', mkAssistant('ast-0')],
        [
          'tool-1',
          mkTool('tool-1', {
            parentId: 'ast-0',
            tool_call_id: 'toolu_mon_0',
          }),
        ],
        ['cb-1', mkSignalCallback('cb-1', 'toolu_mon_0', 1)],
        ['cb-2', mkSignalCallback('cb-2', 'toolu_mon_0', 2)],
        ['cb-3', mkSignalCallback('cb-3', 'toolu_mon_0', 3)],
      ]);
      const collector = new MessageCollector(messageMap, new Map());

      const idNode: IdNode = {
        children: [
          {
            children: [
              { children: [], id: 'cb-1' },
              { children: [], id: 'cb-2' },
              { children: [], id: 'cb-3' },
            ],
            id: 'tool-1',
          },
        ],
        id: 'ast-0',
      };

      const blocks = collector.collectSignalCallbacks(messageMap.get('ast-0')!, idNode);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        sourceToolCallId: 'toolu_mon_0',
        sourceToolMessageId: 'tool-1',
        sourceToolName: 'Monitor',
        type: 'signalCallbacks',
      });
      expect(blocks[0].callbacks.map((c) => c.id)).toEqual(['cb-1', 'cb-2', 'cb-3']);
    });

    it('orders callbacks by sequence even when discovered out-of-order', () => {
      const messageMap = new Map<string, Message>([
        ['ast-0', mkAssistant('ast-0')],
        ['tool-1', mkTool('tool-1', { parentId: 'ast-0', tool_call_id: 'toolu_a' })],
        ['cb-c', mkSignalCallback('cb-c', 'toolu_a', 3)],
        ['cb-a', mkSignalCallback('cb-a', 'toolu_a', 1)],
        ['cb-b', mkSignalCallback('cb-b', 'toolu_a', 2)],
      ]);
      const collector = new MessageCollector(messageMap, new Map());

      const idNode: IdNode = {
        children: [
          {
            children: [
              { children: [], id: 'cb-c' },
              { children: [], id: 'cb-a' },
              { children: [], id: 'cb-b' },
            ],
            id: 'tool-1',
          },
        ],
        id: 'ast-0',
      };

      const [block] = collector.collectSignalCallbacks(messageMap.get('ast-0')!, idNode);
      expect(block.callbacks.map((c) => c.id)).toEqual(['cb-a', 'cb-b', 'cb-c']);
    });

    it('emits one block per source tool when multiple tools fired callbacks in the same chain', () => {
      const messageMap = new Map<string, Message>([
        ['ast-0', mkAssistant('ast-0')],
        ['tool-1', mkTool('tool-1', { parentId: 'ast-0', tool_call_id: 'toolu_mon_0' })],
        ['cb-1', mkSignalCallback('cb-1', 'toolu_mon_0', 1)],
        // Main chain continues: ast-4 follows tool-1 (parentId = tool-1)
        ['ast-4', mkAssistant('ast-4', { parentId: 'tool-1' })],
        ['tool-2', mkTool('tool-2', { parentId: 'ast-4', tool_call_id: 'toolu_mon_1' })],
        ['cb-2a', mkSignalCallback('cb-2a', 'toolu_mon_1', 1)],
        ['cb-2b', mkSignalCallback('cb-2b', 'toolu_mon_1', 2)],
      ]);
      const collector = new MessageCollector(messageMap, new Map());

      const idNode: IdNode = {
        children: [
          {
            children: [
              { children: [], id: 'cb-1' },
              {
                children: [
                  {
                    children: [
                      { children: [], id: 'cb-2a' },
                      { children: [], id: 'cb-2b' },
                    ],
                    id: 'tool-2',
                  },
                ],
                id: 'ast-4',
              },
            ],
            id: 'tool-1',
          },
        ],
        id: 'ast-0',
      };

      const blocks = collector.collectSignalCallbacks(messageMap.get('ast-0')!, idNode);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].sourceToolMessageId).toBe('tool-1');
      expect(blocks[0].callbacks.map((c) => c.id)).toEqual(['cb-1']);
      expect(blocks[1].sourceToolMessageId).toBe('tool-2');
      expect(blocks[1].callbacks.map((c) => c.id)).toEqual(['cb-2a', 'cb-2b']);
    });

    it('returns empty array when no signal-tagged children exist', () => {
      const messageMap = new Map<string, Message>([
        ['ast-0', mkAssistant('ast-0')],
        ['tool-1', mkTool('tool-1', { parentId: 'ast-0', tool_call_id: 'toolu' })],
        // Plain main-chain follower (no metadata.signal) — must NOT be grouped
        ['ast-4', mkAssistant('ast-4', { parentId: 'tool-1' })],
      ]);
      const collector = new MessageCollector(messageMap, new Map());

      const idNode: IdNode = {
        children: [
          {
            children: [{ children: [], id: 'ast-4' }],
            id: 'tool-1',
          },
        ],
        id: 'ast-0',
      };

      const blocks = collector.collectSignalCallbacks(messageMap.get('ast-0')!, idNode);
      expect(blocks).toEqual([]);
    });

    it('ignores signal tag on assistants that DID use tools (back on main chain)', () => {
      // Adapter stamps externalSignal at stream_start (before it knows
      // the step will emit tool_use). The collector must defang this
      // mismatch — a tool-using assistant is NOT a signal callback.
      const messageMap = new Map<string, Message>([
        ['ast-0', mkAssistant('ast-0')],
        ['tool-1', mkTool('tool-1', { parentId: 'ast-0', tool_call_id: 'toolu_mon' })],
        [
          'ast-tools',
          mkAssistant('ast-tools', {
            metadata: {
              signal: {
                sequence: 1,
                sourceToolCallId: 'toolu_mon',
                sourceToolName: 'Monitor',
                type: 'tool-stdout',
              },
            } as any,
            parentId: 'tool-1',
            tools: [
              {
                apiName: 'Bash',
                arguments: '{}',
                id: 'toolu_bash',
                identifier: 'claude-code',
                type: 'default',
              },
            ],
          }),
        ],
      ]);
      const collector = new MessageCollector(messageMap, new Map());

      const idNode: IdNode = {
        children: [
          {
            children: [{ children: [], id: 'ast-tools' }],
            id: 'tool-1',
          },
        ],
        id: 'ast-0',
      };

      const blocks = collector.collectSignalCallbacks(messageMap.get('ast-0')!, idNode);
      expect(blocks).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────
  // collectAssistantGroupMessages skips signal-tagged children
  // ────────────────────────────────────────────────────
  describe('collectAssistantGroupMessages with signal callbacks', () => {
    it('skips signal-tagged callbacks when picking the main-chain follower', () => {
      const messageMap = new Map<string, Message>([
        [
          'ast-0',
          {
            agentId: 'agent-x',
            content: '',
            createdAt: 0,
            id: 'ast-0',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        [
          'tool-1',
          {
            content: '',
            createdAt: 0,
            id: 'tool-1',
            parentId: 'ast-0',
            role: 'tool',
            tool_call_id: 'toolu_mon',
            updatedAt: 0,
          },
        ],
        // Signal callback — listed FIRST in tool-1's children. Without
        // the skip logic, the collector would recurse into this and
        // miss the real follower.
        [
          'cb-1',
          {
            agentId: 'agent-x',
            content: '',
            createdAt: 0,
            id: 'cb-1',
            metadata: {
              signal: {
                sequence: 1,
                sourceToolCallId: 'toolu_mon',
                sourceToolName: 'Monitor',
                type: 'tool-stdout',
              },
            } as any,
            parentId: 'tool-1',
            role: 'assistant',
            updatedAt: 0,
          },
        ],
        // Real main-chain follower.
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
      const collector = new MessageCollector(messageMap, new Map());

      const idNode: IdNode = {
        children: [
          {
            children: [
              { children: [], id: 'cb-1' },
              { children: [], id: 'ast-4' },
            ],
            id: 'tool-1',
          },
        ],
        id: 'ast-0',
      };

      const children: any[] = [];
      collector.collectAssistantGroupMessages(messageMap.get('ast-0')!, idNode, children);

      // Main chain: ast-0 → ast-4 (cb-1 is skipped, handled separately).
      expect(children.map((c) => c.id)).toEqual(['ast-0', 'ast-4']);
    });
  });

  // ────────────────────────────────────────────────────
  // collectAssistantChain cycle guard (regression)
  // ────────────────────────────────────────────────────
  describe('collectAssistantChain', () => {
    const mkAssistant = (id: string, opts?: Partial<Message>): Message => ({
      agentId: 'agent-x',
      content: '',
      createdAt: 0,
      id,
      role: 'assistant',
      updatedAt: 0,
      ...opts,
    });
    const mkTool = (id: string, opts?: Partial<Message>): Message => ({
      content: '',
      createdAt: 0,
      id,
      role: 'tool',
      updatedAt: 0,
      ...opts,
    });
    const bashTool = (id: string) => ({
      apiName: 'Bash',
      arguments: '{}',
      id,
      identifier: 'claude-code',
      type: 'default' as const,
    });

    it('terminates instead of overflowing the stack when a duplicated tool_call_id creates a cycle', () => {
      // Regression: two assistant turns declare the SAME tool_call_id, so
      // collectToolMessages resolves one turn's tool result for the other and
      // the assistant→tool→assistant walk revisits an already-collected
      // assistant. Without marking each assistant visited up front this
      // recurses forever ("Maximum call stack size exceeded").
      const astA = mkAssistant('ast-A', { parentId: 'user-1', tools: [bashTool('tc-dup')] });
      const toolA = mkTool('tool-1', { parentId: 'ast-A', tool_call_id: 'tc-dup' });
      // ast-B is the next turn (child of tool-1) and re-declares the SAME
      // tc-dup, so collectToolMessages(ast-B) resolves tool-1 again → tool-1's
      // child is ast-B → self-loop.
      const astB = mkAssistant('ast-B', { parentId: 'tool-1', tools: [bashTool('tc-dup')] });

      const allMessages: Message[] = [astA, toolA, astB];
      const collector = new MessageCollector(new Map(), new Map());

      const assistantChain: Message[] = [];
      const allToolMessages: Message[] = [];
      const processedIds = new Set<string>();

      expect(() =>
        collector.collectAssistantChain(
          astA,
          allMessages,
          assistantChain,
          allToolMessages,
          processedIds,
        ),
      ).not.toThrow();

      // Each assistant collected exactly once despite the cycle.
      expect(assistantChain.map((m) => m.id)).toEqual(['ast-A', 'ast-B']);
      expect(processedIds.has('ast-A')).toBe(true);
      expect(processedIds.has('ast-B')).toBe(true);
    });

    it('still collects a normal (acyclic) assistant→tool→assistant chain', () => {
      const astA = mkAssistant('ast-A', { parentId: 'user-1', tools: [bashTool('tc-1')] });
      const toolA = mkTool('tool-1', { parentId: 'ast-A', tool_call_id: 'tc-1' });
      const astB = mkAssistant('ast-B', { parentId: 'tool-1', tools: [bashTool('tc-2')] });
      const toolB = mkTool('tool-2', { parentId: 'ast-B', tool_call_id: 'tc-2' });
      const astFinal = mkAssistant('ast-final', { parentId: 'tool-2' });

      const allMessages: Message[] = [astA, toolA, astB, toolB, astFinal];
      const collector = new MessageCollector(new Map(), new Map());

      const assistantChain: Message[] = [];
      const allToolMessages: Message[] = [];
      collector.collectAssistantChain(
        astA,
        allMessages,
        assistantChain,
        allToolMessages,
        new Set(),
      );

      expect(assistantChain.map((m) => m.id)).toEqual(['ast-A', 'ast-B', 'ast-final']);
      expect(allToolMessages.map((m) => m.id)).toEqual(['tool-1', 'tool-2']);
    });

    it('continues past a duplicate edge to the current turn own tool result', () => {
      // A → tool(x) → B; B re-declares the SAME tool_call_id x and has its real
      // continuation C under B's own tool result. collectToolMessages(B) resolves
      // A's tool result (tool-xa) before B's own (tool-xb), and its child is the
      // already-visited B. The walk must skip that duplicate edge and continue to
      // tool-xb → C instead of stopping at B and dropping C.
      const astA = mkAssistant('ast-A', { parentId: 'user-1', tools: [bashTool('tc-x')] });
      const toolXA = mkTool('tool-xa', { parentId: 'ast-A', tool_call_id: 'tc-x' });
      const astB = mkAssistant('ast-B', { parentId: 'tool-xa', tools: [bashTool('tc-x')] });
      const toolXB = mkTool('tool-xb', { parentId: 'ast-B', tool_call_id: 'tc-x' });
      const astC = mkAssistant('ast-C', { parentId: 'tool-xb' });

      const allMessages: Message[] = [astA, toolXA, astB, toolXB, astC];
      const collector = new MessageCollector(new Map(), new Map());

      const assistantChain: Message[] = [];
      collector.collectAssistantChain(astA, allMessages, assistantChain, [], new Set());

      expect(assistantChain.map((m) => m.id)).toEqual(['ast-A', 'ast-B', 'ast-C']);
    });

    it('bridges a toolless prose step wedged between two tool steps (no visual split)', () => {
      // Regression: the model narrates mid-turn (toolless assistant) right before
      // its next tool call. The prose step is part of ONE continuous run, but the
      // chain used to terminate at it — splitting the following tool step into a
      // second AssistantGroup that renders as a separate "Claude Code" bubble.
      // assistant-anchored shape: the prose is a sibling of ast-A's tool result.
      const astA = mkAssistant('ast-A', { parentId: 'user-1', tools: [bashTool('tc-1')] });
      const toolA = mkTool('tool-1', { parentId: 'ast-A', tool_call_id: 'tc-1' });
      const prose = mkAssistant('ast-prose', { createdAt: 1, parentId: 'ast-A' });
      const astC = mkAssistant('ast-C', { parentId: 'ast-prose', tools: [bashTool('tc-2')] });
      const toolC = mkTool('tool-2', { parentId: 'ast-C', tool_call_id: 'tc-2' });
      const astFinal = mkAssistant('ast-final', { parentId: 'tool-2' });

      const allMessages: Message[] = [astA, toolA, prose, astC, toolC, astFinal];
      const collector = new MessageCollector(new Map(), new Map());

      const assistantChain: Message[] = [];
      const allToolMessages: Message[] = [];
      collector.collectAssistantChain(
        astA,
        allMessages,
        assistantChain,
        allToolMessages,
        new Set(),
      );

      // One unbroken chain — prose step folded in, both tool steps kept together.
      expect(assistantChain.map((m) => m.id)).toEqual(['ast-A', 'ast-prose', 'ast-C', 'ast-final']);
      expect(allToolMessages.map((m) => m.id)).toEqual(['tool-1', 'tool-2']);
    });

    it('bridges multiple toolless prose steps before the next tool step', () => {
      // Codex can stream several plain assistant progress updates before the
      // next command. They are still one run and should not split into
      // standalone bubbles between tool-using steps.
      const astA = mkAssistant('ast-A', { parentId: 'user-1', tools: [bashTool('tc-1')] });
      const toolA = mkTool('tool-1', { parentId: 'ast-A', tool_call_id: 'tc-1' });
      const prose1 = mkAssistant('ast-prose-1', { createdAt: 1, parentId: 'ast-A' });
      const prose2 = mkAssistant('ast-prose-2', { createdAt: 2, parentId: 'ast-prose-1' });
      const astC = mkAssistant('ast-C', { parentId: 'ast-prose-2', tools: [bashTool('tc-2')] });
      const toolC = mkTool('tool-2', { parentId: 'ast-C', tool_call_id: 'tc-2' });
      const astFinal = mkAssistant('ast-final', { parentId: 'ast-C' });

      const allMessages: Message[] = [astA, toolA, prose1, prose2, astC, toolC, astFinal];
      const collector = new MessageCollector(new Map(), new Map());

      const assistantChain: Message[] = [];
      const allToolMessages: Message[] = [];
      collector.collectAssistantChain(
        astA,
        allMessages,
        assistantChain,
        allToolMessages,
        new Set(),
      );

      expect(assistantChain.map((m) => m.id)).toEqual([
        'ast-A',
        'ast-prose-1',
        'ast-prose-2',
        'ast-C',
        'ast-final',
      ]);
      expect(allToolMessages.map((m) => m.id)).toEqual(['tool-1', 'tool-2']);
    });
  });
});
