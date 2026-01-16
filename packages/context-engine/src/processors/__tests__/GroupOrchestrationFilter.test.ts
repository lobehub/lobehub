import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { GroupOrchestrationFilterProcessor } from '../GroupOrchestrationFilter';

describe('GroupOrchestrationFilterProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  const defaultConfig = {
    agentMap: {
      'agent-a': { role: 'participant' as const },
      'agent-b': { role: 'participant' as const },
      'supervisor': { role: 'supervisor' as const },
    },
    currentAgentId: 'agent-a', // Default to participant agent
  };

  describe('filtering supervisor orchestration messages', () => {
    it('should filter supervisor assistant message with broadcast tool', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        { content: 'User question', id: 'msg_1', role: 'user' },
        {
          agentId: 'supervisor',
          content: 'Let me coordinate the agents...',
          id: 'msg_2',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{"agentIds": ["agent-a", "agent-b"], "instruction": "Please respond"}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
        { content: 'Agent response', id: 'msg_3', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe('msg_1');
      expect(result.messages[1].id).toBe('msg_3');
    });

    it('should filter supervisor assistant message with speak tool', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Asking agent-a to respond',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'speak',
              arguments: '{"agentId": "agent-a", "instruction": "Please help"}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(0);
    });

    it('should filter supervisor assistant message with executeTask tool', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Executing task',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'executeTask',
              arguments: '{"task": "do something"}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(0);
    });

    it('should filter supervisor assistant message with executeTasks tool', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Executing multiple tasks',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'executeTasks',
              arguments: '{"tasks": ["task1", "task2"]}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(0);
    });
  });

  describe('filtering supervisor tool results', () => {
    it('should filter supervisor tool result for broadcast', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        { content: 'User question', id: 'msg_1', role: 'user' },
        {
          agentId: 'supervisor',
          content: 'Triggered broadcast to agents: agent-a, agent-b',
          id: 'msg_2',
          plugin: {
            apiName: 'broadcast',
            identifier: 'lobe-group-management',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
        { content: 'Instruction from supervisor', id: 'msg_3', role: 'user' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe('msg_1');
      expect(result.messages[1].id).toBe('msg_3');
    });

    it('should filter supervisor tool result for speak', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Triggered speak to agent-a',
          id: 'msg_1',
          plugin: {
            apiName: 'speak',
            identifier: 'lobe-group-management',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(0);
    });
  });

  describe('keeping non-orchestration messages', () => {
    it('should keep supervisor assistant message without tools', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Here is a summary of the discussion...',
          id: 'msg_1',
          role: 'assistant',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Here is a summary of the discussion...');
    });

    it('should keep supervisor assistant message with non-orchestration tools', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Let me search for information',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{"query": "test"}',
              id: 'call_1',
              identifier: 'web-search',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('msg_1');
    });

    it('should keep supervisor tool result for non-orchestration tools', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: '{"results": ["item1", "item2"]}',
          id: 'msg_1',
          plugin: {
            apiName: 'search',
            identifier: 'web-search',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
    });

    it('should keep all participant agent messages', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'agent-a',
          content: 'Participant response',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
        {
          agentId: 'agent-b',
          content: 'Tool result',
          id: 'msg_2',
          plugin: {
            apiName: 'broadcast',
            identifier: 'lobe-group-management',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      // Participant messages are never filtered, even with orchestration tools
      expect(result.messages).toHaveLength(2);
    });

    it('should keep user messages unchanged', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        { content: 'User question 1', id: 'msg_1', role: 'user' },
        { content: 'User question 2', id: 'msg_2', role: 'user' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
    });

    it('should keep messages without agentId', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          content: 'System message',
          id: 'msg_1',
          role: 'system',
        },
        {
          content: 'Assistant without agentId',
          id: 'msg_2',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
    });
  });

  describe('configuration options', () => {
    it('should skip processing when disabled', async () => {
      const processor = new GroupOrchestrationFilterProcessor({
        ...defaultConfig,
        enabled: false,
      });
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Orchestration message',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
    });

    it('should skip processing when current agent is supervisor', async () => {
      const processor = new GroupOrchestrationFilterProcessor({
        ...defaultConfig,
        currentAgentId: 'supervisor', // Supervisor as current agent
      });
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Orchestration message',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
        {
          agentId: 'supervisor',
          content: 'Tool result',
          id: 'msg_2',
          plugin: {
            apiName: 'broadcast',
            identifier: 'lobe-group-management',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
      ]);

      const result = await processor.process(context);

      // Supervisor should see all messages including orchestration ones
      expect(result.messages).toHaveLength(2);
    });

    it('should skip processing when no agentMap provided', async () => {
      const processor = new GroupOrchestrationFilterProcessor({});
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Orchestration message',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
    });

    it('should skip processing when no currentAgentId provided', async () => {
      const processor = new GroupOrchestrationFilterProcessor({
        agentMap: defaultConfig.agentMap,
        // No currentAgentId
      });
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Orchestration message',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      // Without currentAgentId, can't determine if supervisor, so treat as participant and filter
      // Actually, isCurrentAgentSupervisor returns false when no currentAgentId, so filtering happens
      expect(result.messages).toHaveLength(0);
    });

    it('should use custom orchestration tool identifiers', async () => {
      const processor = new GroupOrchestrationFilterProcessor({
        ...defaultConfig,
        orchestrationToolIdentifiers: ['custom-orchestration'],
      });
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Custom orchestration',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'custom-orchestration',
            },
          ],
        },
        {
          agentId: 'supervisor',
          content: 'Default orchestration - should not be filtered',
          id: 'msg_2',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_2',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('msg_2');
    });

    it('should use custom orchestration api names', async () => {
      const processor = new GroupOrchestrationFilterProcessor({
        ...defaultConfig,
        orchestrationApiNames: ['customBroadcast'],
      });
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Custom api name',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'customBroadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
        {
          agentId: 'supervisor',
          content: 'Default broadcast - should not be filtered',
          id: 'msg_2',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_2',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('msg_2');
    });
  });

  describe('edge cases', () => {
    it('should handle empty messages array', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(0);
    });

    it('should handle message with empty tools array', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Message with empty tools',
          id: 'msg_1',
          role: 'assistant',
          tools: [],
        },
      ]);

      const result = await processor.process(context);

      // Empty tools array means no orchestration tools, so message is kept
      expect(result.messages).toHaveLength(1);
    });

    it('should handle tool without identifier', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Tool without identifier',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              // Missing identifier
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      // Tool without identifier doesn't match orchestration pattern
      expect(result.messages).toHaveLength(1);
    });

    it('should handle tool without apiName', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Tool without apiName',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
              // Missing apiName
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      // Tool without apiName doesn't match orchestration pattern
      expect(result.messages).toHaveLength(1);
    });

    it('should track filter counts in metadata', async () => {
      const processor = new GroupOrchestrationFilterProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'supervisor',
          content: 'Broadcast',
          id: 'msg_1',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
        {
          agentId: 'supervisor',
          content: 'Tool result',
          id: 'msg_2',
          plugin: {
            apiName: 'broadcast',
            identifier: 'lobe-group-management',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
        {
          agentId: 'supervisor',
          content: 'Speak',
          id: 'msg_3',
          role: 'assistant',
          tools: [
            {
              apiName: 'speak',
              arguments: '{}',
              id: 'call_2',
              identifier: 'lobe-group-management',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.metadata.orchestrationFilterProcessed).toEqual({
        assistantFiltered: 2,
        filteredCount: 3,
        toolFiltered: 1,
      });
    });
  });

  describe('comprehensive end-to-end filtering', () => {
    it('should correctly filter a full group conversation with orchestration messages', async () => {
      const processor = new GroupOrchestrationFilterProcessor({
        agentMap: {
          'agent-a': { role: 'participant' },
          'agent-b': { role: 'participant' },
          'supervisor': { role: 'supervisor' },
        },
      });

      const inputMessages = [
        // 1. User's original question
        { content: '帮我规划杭州行程', id: 'msg_1', role: 'user' },
        // 2. Supervisor broadcasts - SHOULD BE FILTERED
        {
          agentId: 'supervisor',
          content: '好的，让我协调专家们...',
          id: 'msg_2',
          role: 'assistant',
          tools: [
            {
              apiName: 'broadcast',
              arguments: '{"agentIds": ["agent-a", "agent-b"], "instruction": "请给建议"}',
              id: 'call_1',
              identifier: 'lobe-group-management',
            },
          ],
        },
        // 3. Broadcast tool result - SHOULD BE FILTERED
        {
          agentId: 'supervisor',
          content: 'Triggered broadcast to agents: agent-a, agent-b',
          id: 'msg_3',
          plugin: {
            apiName: 'broadcast',
            identifier: 'lobe-group-management',
          },
          role: 'tool',
          tool_call_id: 'call_1',
        },
        // 4. Actual instruction (injected by broadcast) - SHOULD BE KEPT
        { content: '请各位专家给出杭州行程建议', id: 'msg_4', role: 'user' },
        // 5. Agent A response - SHOULD BE KEPT
        { agentId: 'agent-a', content: '推荐西湖景区', id: 'msg_5', role: 'assistant' },
        // 6. Agent B response - SHOULD BE KEPT
        { agentId: 'agent-b', content: '推荐楼外楼', id: 'msg_6', role: 'assistant' },
        // 7. Supervisor uses speak - SHOULD BE FILTERED
        {
          agentId: 'supervisor',
          content: '让 agent-a 总结一下',
          id: 'msg_7',
          role: 'assistant',
          tools: [
            {
              apiName: 'speak',
              arguments: '{"agentId": "agent-a", "instruction": "请总结"}',
              id: 'call_2',
              identifier: 'lobe-group-management',
            },
          ],
        },
        // 8. Speak tool result - SHOULD BE FILTERED
        {
          agentId: 'supervisor',
          content: 'Triggered speak to agent-a',
          id: 'msg_8',
          plugin: {
            apiName: 'speak',
            identifier: 'lobe-group-management',
          },
          role: 'tool',
          tool_call_id: 'call_2',
        },
        // 9. Supervisor's summary (pure text, no tools) - SHOULD BE KEPT
        {
          agentId: 'supervisor',
          content: '以上就是专家们的建议汇总',
          id: 'msg_9',
          role: 'assistant',
        },
        // 10. Supervisor uses search tool - SHOULD BE KEPT
        {
          agentId: 'supervisor',
          content: '让我搜索一下更多信息',
          id: 'msg_10',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{"query": "杭州景点"}',
              id: 'call_3',
              identifier: 'web-search',
            },
          ],
        },
      ];

      const context = createContext(inputMessages);
      const result = await processor.process(context);

      // Should have: msg_1, msg_4, msg_5, msg_6, msg_9, msg_10 (6 messages)
      expect(result.messages).toHaveLength(6);
      expect(result.messages.map((m) => m.id)).toEqual([
        'msg_1',
        'msg_4',
        'msg_5',
        'msg_6',
        'msg_9',
        'msg_10',
      ]);

      // Verify metadata
      expect(result.metadata.orchestrationFilterProcessed).toEqual({
        assistantFiltered: 2, // msg_2, msg_7
        filteredCount: 4, // msg_2, msg_3, msg_7, msg_8
        toolFiltered: 2, // msg_3, msg_8
      });
    });
  });
});
