import { describe, expect, it } from 'vitest';

import { PipelineContext } from '../../types';
import { GroupMessageSenderProcessor } from '../GroupMessageSender';

describe('GroupMessageSenderProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  describe('Basic Scenarios', () => {
    it('should inject sender info into assistant message with agentId', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
        },
      });

      const input: any[] = [
        { role: 'user', content: 'What is the weather?' },
        { role: 'assistant', content: 'The weather is sunny.', agentId: 'agt_weather' },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      expect(result.messages).toHaveLength(2);

      // User message should be unchanged
      expect(result.messages[0].content).toBe('What is the weather?');

      // Assistant message should have speaker tag prepended
      const assistantContent = result.messages[1].content;
      expect(assistantContent).toMatch(/^<speaker name="Weather Expert" \/>/);
      expect(assistantContent).toContain('The weather is sunny.');

      // Check metadata
      expect(result.metadata.groupMessageSenderProcessed).toBe(1);
    });

    it('should inject sender info for supervisor role', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_supervisor: { name: 'Group Supervisor', role: 'supervisor' },
        },
      });

      const input: any[] = [
        { role: 'assistant', content: 'I will coordinate the agents.', agentId: 'agt_supervisor' },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      const assistantContent = result.messages[0].content;
      expect(assistantContent).toMatch(/^<speaker name="Group Supervisor" \/>/);
    });

    it('should not modify assistant message without agentId', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
        },
      });

      const input: any[] = [{ role: 'assistant', content: 'Hello from assistant.' }];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should be unchanged
      expect(result.messages[0].content).toBe('Hello from assistant.');
      expect(result.metadata.groupMessageSenderProcessed).toBe(0);
    });

    it('should not modify assistant message with unknown agentId', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
        },
      });

      const input: any[] = [{ role: 'assistant', content: 'Hello.', agentId: 'agt_unknown' }];

      const context = createContext(input);
      const result = await processor.process(context);

      // Should be unchanged because agentId not in map
      expect(result.messages[0].content).toBe('Hello.');
      expect(result.metadata.groupMessageSenderProcessed).toBe(0);
    });

    it('should not modify user or tool messages', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
        },
      });

      const input: any[] = [
        { role: 'user', content: 'Hello', agentId: 'agt_weather' },
        { role: 'tool', content: 'Tool result', agentId: 'agt_weather' },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[1].content).toBe('Tool result');
      expect(result.metadata.groupMessageSenderProcessed).toBe(0);
    });
  });

  describe('Multiple Messages', () => {
    it('should process multiple assistant messages from different agents', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
          agt_news: { name: 'News Reporter', role: 'participant' },
          agt_supervisor: { name: 'Supervisor', role: 'supervisor' },
        },
      });

      const input: any[] = [
        { role: 'user', content: 'Give me updates' },
        { role: 'assistant', content: 'Weather is sunny.', agentId: 'agt_weather' },
        { role: 'assistant', content: 'Top news today.', agentId: 'agt_news' },
        { role: 'assistant', content: 'Summary complete.', agentId: 'agt_supervisor' },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      expect(result.messages).toHaveLength(4);

      // Check each assistant message has correct speaker tag prepended
      expect(result.messages[1].content).toMatch(/^<speaker name="Weather Expert" \/>/);
      expect(result.messages[2].content).toMatch(/^<speaker name="News Reporter" \/>/);
      expect(result.messages[3].content).toMatch(/^<speaker name="Supervisor" \/>/);

      expect(result.metadata.groupMessageSenderProcessed).toBe(3);
    });
  });

  describe('Multimodal Messages', () => {
    it('should handle array content (multimodal messages)', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
        },
      });

      const input: any[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here is the weather chart.' },
            { type: 'image_url', image_url: { url: 'https://example.com/chart.png' } },
          ],
          agentId: 'agt_weather',
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      const content = result.messages[0].content as any[];
      expect(Array.isArray(content)).toBe(true);

      // The first text part should have speaker tag prepended
      const textPart = content.find((p: any) => p.type === 'text');
      expect(textPart.text).toMatch(/^<speaker name="Weather Expert" \/>/);
      expect(textPart.text).toContain('Here is the weather chart.');

      // Image part should be unchanged
      const imagePart = content.find((p: any) => p.type === 'image_url');
      expect(imagePart.image_url.url).toBe('https://example.com/chart.png');

      expect(result.metadata.groupMessageSenderProcessed).toBe(1);
    });

    it('should append to the last text part in multimodal content', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
        },
      });

      const input: any[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First text.' },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
            { type: 'text', text: 'Last text.' },
          ],
          agentId: 'agt_weather',
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      const content = result.messages[0].content;

      // First text part should have speaker tag prepended
      expect(content[0].text).toMatch(/^<speaker name="Weather Expert" \/>/);
      expect(content[0].text).toContain('First text.');

      // Last text should be unchanged
      expect(content[2].text).toBe('Last text.');
    });
  });

  describe('Edge Cases', () => {
    it('should skip processing with empty agentMap', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {},
      });

      const input: any[] = [{ role: 'assistant', content: 'Hello', agentId: 'agt_weather' }];

      const context = createContext(input);
      const result = await processor.process(context);

      expect(result.messages[0].content).toBe('Hello');
    });

    it('should handle empty messages array', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
        },
      });

      const context = createContext([]);
      const result = await processor.process(context);

      expect(result.messages).toHaveLength(0);
      expect(result.metadata.groupMessageSenderProcessed).toBe(0);
    });

    it('should preserve original message properties', async () => {
      const processor = new GroupMessageSenderProcessor({
        agentMap: {
          agt_weather: { name: 'Weather Expert', role: 'participant' },
        },
      });

      const input: any[] = [
        {
          role: 'assistant',
          content: 'Weather info.',
          agentId: 'agt_weather',
          id: 'msg-123',
          createdAt: '2025-01-01T00:00:00Z',
          customField: 'custom value',
        },
      ];

      const context = createContext(input);
      const result = await processor.process(context);

      const msg = result.messages[0];
      expect(msg.id).toBe('msg-123');
      expect(msg.createdAt).toBe('2025-01-01T00:00:00Z');
      expect(msg.customField).toBe('custom value');
      expect(msg.agentId).toBe('agt_weather');
    });
  });
});
