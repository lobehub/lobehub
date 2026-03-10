import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { TaskMessageProcessor } from '../TaskMessage';

describe('TaskMessageProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  describe('basic functionality', () => {
    it('should convert task message with instruction to assistant message', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: 'Task completed successfully',
          metadata: {
            instruction: 'Search for information about AI',
          },
          agentName: 'Research Agent',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].content).toContain('Research Agent');
      expect(result.messages[0].content).toContain('Search for information about AI');
      expect(result.messages[0].content).toContain('Task completed successfully');
      expect(result.metadata.taskMessagesProcessed).toBe(1);
    });

    it('should convert task message without instruction to assistant message', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: 'Simple result',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].content).toBe('Simple result');
      expect(result.metadata.taskMessagesProcessed).toBe(1);
    });

    it('should not modify non-task messages', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi there' },
        {
          id: 'msg-3',
          role: 'task',
          content: 'Task result',
          metadata: { instruction: 'Do something' },
          agentName: 'Test Agent',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Hi there');
      expect(result.messages[2].role).toBe('assistant');
      expect(result.messages[2].content).toContain('Test Agent');
      expect(result.metadata.taskMessagesProcessed).toBe(1);
    });
  });

  describe('template formatting', () => {
    it('should use default template format', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: 'Result content here',
          metadata: { instruction: 'Instruction content here' },
          agentName: 'My Agent',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].content).toBe(
        `[Task Result from My Agent]

**Task Instruction:**
Instruction content here

**Task Result:**
Result content here`,
      );
    });

    it('should use custom template', async () => {
      const customTemplate = '# {{agentName}}\nInstruction: {{instruction}}\nResult: {{content}}';
      const processor = new TaskMessageProcessor({ template: customTemplate });
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: 'Done',
          metadata: { instruction: 'Do it' },
          agentName: 'Agent X',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].content).toBe('# Agent X\nInstruction: Do it\nResult: Done');
    });

    it('should use meta.avatar as fallback for agentName', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: 'Result',
          metadata: { instruction: 'Task' },
          meta: { avatar: 'Avatar Name' },
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].content).toContain('Avatar Name');
    });

    it('should use default "Sub Agent" when no name available', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: 'Result',
          metadata: { instruction: 'Task' },
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].content).toContain('[Task Result from Sub Agent]');
    });
  });

  describe('multiple task messages', () => {
    it('should process multiple task messages', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: 'Result 1',
          metadata: { instruction: 'Task 1' },
          agentName: 'Agent 1',
        },
        { id: 'msg-2', role: 'user', content: 'User message' },
        {
          id: 'msg-3',
          role: 'task',
          content: 'Result 2',
          metadata: { instruction: 'Task 2' },
          agentName: 'Agent 2',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].content).toContain('Agent 1');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[2].role).toBe('assistant');
      expect(result.messages[2].content).toContain('Agent 2');
      expect(result.metadata.taskMessagesProcessed).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: '',
          metadata: { instruction: 'Do something' },
          agentName: 'Agent',
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].content).toContain('Do something');
      expect(result.messages[0].content).toContain('**Task Result:**\n');
    });

    it('should handle empty messages array', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([]);

      const result = await processor.process(context);

      expect(result.messages).toHaveLength(0);
      expect(result.metadata.taskMessagesProcessed).toBe(0);
    });

    it('should preserve other message properties', async () => {
      const processor = new TaskMessageProcessor();
      const context = createContext([
        {
          id: 'msg-1',
          role: 'task',
          content: 'Result',
          metadata: { instruction: 'Task', customField: 'value' },
          agentName: 'Agent',
          createdAt: 1234567890,
          extra: { foo: 'bar' },
        },
      ]);

      const result = await processor.process(context);

      expect(result.messages[0].id).toBe('msg-1');
      expect(result.messages[0].createdAt).toBe(1234567890);
      expect(result.messages[0].extra).toEqual({ foo: 'bar' });
      expect(result.messages[0].metadata.customField).toBe('value');
    });
  });
});
