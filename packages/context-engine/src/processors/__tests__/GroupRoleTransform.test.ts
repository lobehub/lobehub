import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { GroupRoleTransformProcessor } from '../GroupRoleTransform';

describe('GroupRoleTransformProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  const defaultConfig = {
    agentMap: {
      'agent-a': { name: 'Agent A', role: 'participant' as const },
      'agent-b': { name: 'Agent B', role: 'participant' as const },
      'supervisor': { name: 'Supervisor', role: 'supervisor' as const },
    },
    currentAgentId: 'agent-a',
  };

  describe('assistant message transformation', () => {
    it('should keep current agent messages as assistant', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        { content: 'Hello', role: 'user' },
        { agentId: 'agent-a', content: 'Response from current agent', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Response from current agent');
    });

    it('should transform other agent messages to user with speaker tag', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        { content: 'Hello', role: 'user' },
        { agentId: 'agent-b', content: 'Response from other agent', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('<speaker name="Agent B" />');
      expect(result.messages[1].content).toContain('Response from other agent');
    });

    it('should transform supervisor messages to user when current agent is participant', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        { content: 'Hello', role: 'user' },
        { agentId: 'supervisor', content: 'Supervisor response', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('<speaker name="Supervisor" />');
    });

    it('should keep assistant messages without agentId unchanged', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        { content: 'Hello', role: 'user' },
        { content: 'Response without agentId', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Response without agentId');
    });
  });

  describe('assistant message with tools', () => {
    it('should transform other agent message with tools to user with tool_use section', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        { content: 'Hello', role: 'user' },
        {
          agentId: 'agent-b',
          content: 'Let me check the weather',
          role: 'assistant',
          tools: [
            {
              apiName: 'getWeather',
              arguments: '{"city": "Beijing"}',
              id: 'call_123',
              identifier: 'weather-plugin',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('<speaker name="Agent B" />');
      expect(result.messages[1].content).toContain('Let me check the weather');
      expect(result.messages[1].content).toContain('<tool_use>');
      expect(result.messages[1].content).toContain(
        '<tool id="call_123" name="weather-plugin.getWeather">',
      );
      expect(result.messages[1].content).toContain('{"city": "Beijing"}');
      expect(result.messages[1].content).toContain('</tool>');
      expect(result.messages[1].content).toContain('</tool_use>');
      expect(result.messages[1].tools).toBeUndefined();
    });

    it('should transform other agent message with multiple tools', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'agent-b',
          content: 'Checking multiple things',
          role: 'assistant',
          tools: [
            {
              apiName: 'getWeather',
              arguments: '{"city": "Beijing"}',
              id: 'call_1',
              identifier: 'weather',
            },
            {
              apiName: 'getTime',
              arguments: '{"timezone": "UTC"}',
              id: 'call_2',
              identifier: 'time',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toContain('<tool id="call_1" name="weather.getWeather">');
      expect(result.messages[0].content).toContain('<tool id="call_2" name="time.getTime">');
    });

    it('should keep current agent message with tools as assistant', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'agent-a',
          content: 'Current agent using tools',
          role: 'assistant',
          tools: [
            {
              apiName: 'search',
              arguments: '{"q": "test"}',
              id: 'call_xyz',
              identifier: 'search-plugin',
            },
          ],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].tools).toBeDefined();
      expect(result.messages[0].content).not.toContain('<speaker');
    });
  });

  describe('tool message transformation', () => {
    it('should transform other agent tool messages to user with tool_result', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'agent-b',
          content: '{"temperature": 25}',
          plugin: {
            apiName: 'getWeather',
            identifier: 'weather-plugin',
          },
          role: 'tool',
          tool_call_id: 'call_123',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toContain('<speaker name="Agent B" />');
      expect(result.messages[0].content).toContain(
        '<tool_result id="call_123" name="weather-plugin.getWeather">',
      );
      expect(result.messages[0].content).toContain('{"temperature": 25}');
      expect(result.messages[0].content).toContain('</tool_result>');
      expect(result.messages[0].tool_call_id).toBeUndefined();
      expect(result.messages[0].plugin).toBeUndefined();
    });

    it('should keep current agent tool messages unchanged', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'agent-a',
          content: '{"result": "data"}',
          plugin: {
            apiName: 'search',
            identifier: 'search-plugin',
          },
          role: 'tool',
          tool_call_id: 'call_abc',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('tool');
      expect(result.messages[0].tool_call_id).toBe('call_abc');
      expect(result.messages[0].content).not.toContain('<speaker');
    });

    it('should keep tool messages without agentId unchanged', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        {
          content: '{"result": "data"}',
          role: 'tool',
          tool_call_id: 'call_abc',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('tool');
      expect(result.messages[0].tool_call_id).toBe('call_abc');
    });
  });

  describe('mixed conversation', () => {
    it('should handle mixed conversation with multiple agents', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        { content: 'User question', role: 'user' },
        { agentId: 'supervisor', content: 'Supervisor intro', role: 'assistant' },
        { agentId: 'agent-b', content: 'Agent B response', role: 'assistant' },
        { agentId: 'agent-a', content: 'Current agent response', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(4);
      // User message unchanged
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('User question');
      // Supervisor transformed to user
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('<speaker name="Supervisor" />');
      // Agent B transformed to user
      expect(result.messages[2].role).toBe('user');
      expect(result.messages[2].content).toContain('<speaker name="Agent B" />');
      // Current agent stays as assistant
      expect(result.messages[3].role).toBe('assistant');
      expect(result.messages[3].content).toBe('Current agent response');
    });

    it('should handle tool call and result from other agent', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        { content: 'Check weather', role: 'user' },
        {
          agentId: 'agent-b',
          content: 'Checking...',
          role: 'assistant',
          tools: [{ apiName: 'get', arguments: '{}', id: 'call_1', identifier: 'weather' }],
        },
        {
          agentId: 'agent-b',
          content: '{"temp": 25}',
          plugin: { apiName: 'get', identifier: 'weather' },
          role: 'tool',
          tool_call_id: 'call_1',
        },
        { agentId: 'agent-a', content: 'Based on the weather...', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(4);
      // User unchanged
      expect(result.messages[0].role).toBe('user');
      // Agent B assistant with tool -> user
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('<tool_use>');
      // Agent B tool result -> user
      expect(result.messages[2].role).toBe('user');
      expect(result.messages[2].content).toContain('<tool_result');
      // Current agent -> assistant
      expect(result.messages[3].role).toBe('assistant');
    });
  });

  describe('edge cases', () => {
    it('should skip processing when no currentAgentId provided', async () => {
      const processor = new GroupRoleTransformProcessor({
        agentMap: defaultConfig.agentMap,
        currentAgentId: '',
      });
      const context = createContext([{ agentId: 'agent-b', content: 'Test', role: 'assistant' }]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('assistant');
    });

    it('should skip processing when no agentMap provided', async () => {
      const processor = new GroupRoleTransformProcessor({
        agentMap: {},
        currentAgentId: 'agent-a',
      });
      const context = createContext([{ agentId: 'agent-b', content: 'Test', role: 'assistant' }]);

      const result = await processor.process(context);

      // No agentMap entry for agent-b, so message is unchanged
      expect(result.messages[0].role).toBe('assistant');
    });

    it('should handle empty messages array', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(0);
    });

    it('should handle message with empty content', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([{ agentId: 'agent-b', content: '', role: 'assistant' }]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toContain('<speaker name="Agent B" />');
    });

    it('should handle array content (multimodal)', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        {
          agentId: 'agent-b',
          content: [
            { text: 'Here is the image analysis', type: 'text' },
            { image_url: 'data:image/png;base64,...', type: 'image_url' },
          ],
          role: 'assistant',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toContain('<speaker name="Agent B" />');
      expect(result.messages[0].content).toContain('Here is the image analysis');
    });

    it('should track transformation counts in metadata', async () => {
      const processor = new GroupRoleTransformProcessor(defaultConfig);
      const context = createContext([
        { agentId: 'agent-b', content: 'Msg 1', role: 'assistant' },
        { agentId: 'agent-b', content: 'Result', role: 'tool', tool_call_id: 'call_1' },
        { agentId: 'agent-a', content: 'Current', role: 'assistant' },
      ]);

      const result = await processor.process(context);

      expect(result.metadata.groupRoleTransformProcessed).toEqual({
        assistantTransformed: 1,
        toolTransformed: 1,
      });
    });
  });

  describe('custom tool name generator', () => {
    it('should use custom genToolName function', async () => {
      const processor = new GroupRoleTransformProcessor({
        ...defaultConfig,
        genToolName: (identifier, apiName) => `custom_${identifier}_${apiName}`,
      });
      const context = createContext([
        {
          agentId: 'agent-b',
          content: 'Test',
          role: 'assistant',
          tools: [{ apiName: 'search', arguments: '{}', id: 'call_1', identifier: 'plugin' }],
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].content).toContain('name="custom_plugin_search"');
    });
  });

  describe('comprehensive end-to-end transformation', () => {
    it('should correctly transform a full group conversation with 8 messages', async () => {
      const processor = new GroupRoleTransformProcessor({
        agentMap: {
          'agent-a': { name: 'Travel Advisor', role: 'participant' },
          'agent-b': { name: 'Weather Expert', role: 'participant' },
          'agent-c': { name: 'Food Critic', role: 'participant' },
          'supervisor': { name: 'Supervisor', role: 'supervisor' },
        },
        currentAgentId: 'agent-a',
      });

      const inputMessages = [
        // 1. User's original question
        { content: '帮我规划一下明天去杭州的行程', id: 'msg_1', role: 'user' },
        // 2. Supervisor's broadcast instruction (from orchestration)
        {
          agentId: 'supervisor',
          content: '请各位专家从自己的角度给出建议',
          id: 'msg_2',
          role: 'assistant',
        },
        // 3. Weather Expert's response with tool
        {
          agentId: 'agent-b',
          content: '让我查一下杭州明天的天气',
          id: 'msg_3',
          role: 'assistant',
          tools: [
            {
              apiName: 'getWeather',
              arguments: '{"city": "杭州", "date": "tomorrow"}',
              id: 'call_weather_1',
              identifier: 'weather-plugin',
            },
          ],
        },
        // 4. Weather tool result
        {
          agentId: 'agent-b',
          content: '{"temperature": 22, "weather": "多云", "humidity": 65}',
          id: 'msg_4',
          plugin: { apiName: 'getWeather', identifier: 'weather-plugin' },
          role: 'tool',
          tool_call_id: 'call_weather_1',
        },
        // 5. Weather Expert's final response
        {
          agentId: 'agent-b',
          content: '明天杭州天气不错，22度多云，适合出行',
          id: 'msg_5',
          role: 'assistant',
        },
        // 6. Food Critic's response
        {
          agentId: 'agent-c',
          content: '推荐去楼外楼吃正宗的西湖醋鱼',
          id: 'msg_6',
          role: 'assistant',
        },
        // 7. Current agent (Travel Advisor)'s response - should stay as assistant
        {
          agentId: 'agent-a',
          content: '综合以上建议，我来帮你规划具体行程',
          id: 'msg_7',
          role: 'assistant',
        },
        // 8. Follow-up user question
        { content: '还有什么景点推荐吗？', id: 'msg_8', role: 'user' },
      ];

      const context = createContext(inputMessages);
      const result = await processor.process(context);

      // Verify the entire output array
      expect(result.messages).toEqual([
        // 1. User message - unchanged
        { content: '帮我规划一下明天去杭州的行程', id: 'msg_1', role: 'user' },
        // 2. Supervisor -> user with speaker tag
        {
          agentId: 'supervisor',
          content: '<speaker name="Supervisor" />\n请各位专家从自己的角度给出建议',
          id: 'msg_2',
          role: 'user',
        },
        // 3. Weather Expert with tool -> user with speaker + tool_use
        {
          agentId: 'agent-b',
          content: `<speaker name="Weather Expert" />
让我查一下杭州明天的天气

<tool_use>
<tool id="call_weather_1" name="weather-plugin.getWeather">
{"city": "杭州", "date": "tomorrow"}
</tool>
</tool_use>`,
          id: 'msg_3',
          role: 'user',
          tools: undefined,
        },
        // 4. Tool result -> user with speaker + tool_result
        {
          agentId: 'agent-b',
          content: `<speaker name="Weather Expert" />
<tool_result id="call_weather_1" name="weather-plugin.getWeather">
{"temperature": 22, "weather": "多云", "humidity": 65}
</tool_result>`,
          id: 'msg_4',
          plugin: undefined,
          role: 'user',
          tool_call_id: undefined,
        },
        // 5. Weather Expert's final response -> user with speaker
        {
          agentId: 'agent-b',
          content: '<speaker name="Weather Expert" />\n明天杭州天气不错，22度多云，适合出行',
          id: 'msg_5',
          role: 'user',
        },
        // 6. Food Critic -> user with speaker
        {
          agentId: 'agent-c',
          content: '<speaker name="Food Critic" />\n推荐去楼外楼吃正宗的西湖醋鱼',
          id: 'msg_6',
          role: 'user',
        },
        // 7. Current agent (Travel Advisor) - stays as assistant, no speaker tag
        {
          agentId: 'agent-a',
          content: '综合以上建议，我来帮你规划具体行程',
          id: 'msg_7',
          role: 'assistant',
        },
        // 8. User message - unchanged
        { content: '还有什么景点推荐吗？', id: 'msg_8', role: 'user' },
      ]);

      // Verify metadata
      expect(result.metadata.groupRoleTransformProcessed).toEqual({
        assistantTransformed: 4, // supervisor, agent-b x2, agent-c
        toolTransformed: 1, // weather tool result
      });
    });
  });
});
