import { describe, expect, it } from 'vitest';

import {
  formatPlaceholderValues,
  parsePlaceholderVariables,
  parsePlaceholderVariablesMessages,
  PlaceholderVariablesProcessor,
  renderPlaceholderTemplate,
} from '../PlaceholderVariables';

describe('PlaceholderVariablesProcessor', () => {
  const mockVariableGenerators = {
    date: () => '2023-12-25',
    time: () => '14:30:45',
    username: () => 'TestUser',
    random: () => '12345',
    nested: () => 'Value with {{date}} inside',
  };

  describe('parsePlaceholderVariables', () => {
    it('should replace simple placeholder variables', () => {
      const text = 'Today is {{date}} and the time is {{time}}';
      const result = parsePlaceholderVariables(text, mockVariableGenerators);
      expect(result).toBe('Today is 2023-12-25 and the time is 14:30:45');
    });

    it('should handle missing variables gracefully', () => {
      const text = 'Hello {{username}}, missing: {{missing}}';
      const result = parsePlaceholderVariables(text, mockVariableGenerators);
      expect(result).toBe('Hello TestUser, missing: {{missing}}');
    });

    it('should handle nested variables with recursion', () => {
      const text = 'Nested: {{nested}}';
      const result = parsePlaceholderVariables(text, mockVariableGenerators);
      expect(result).toBe('Nested: Value with 2023-12-25 inside');
    });

    it('should respect depth limit', () => {
      const text = 'Nested: {{nested}}';
      const result = parsePlaceholderVariables(text, mockVariableGenerators, 1);
      expect(result).toBe('Nested: Value with {{date}} inside');
    });

    it('should handle empty text', () => {
      const text = '';
      const result = parsePlaceholderVariables(text, mockVariableGenerators);
      expect(result).toBe('');
    });

    it('should handle text without placeholders', () => {
      const text = 'No placeholders here';
      const result = parsePlaceholderVariables(text, mockVariableGenerators);
      expect(result).toBe('No placeholders here');
    });
  });

  describe('parsePlaceholderVariablesMessages', () => {
    it('should process string content messages', () => {
      const messages = [
        {
          id: '1',
          role: 'user',
          content: 'Hello {{username}}, today is {{date}}',
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Hi there! The time is {{time}}',
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages, mockVariableGenerators);

      expect(result).toEqual([
        {
          id: '1',
          role: 'user',
          content: 'Hello TestUser, today is 2023-12-25',
        },
        {
          id: '2',
          role: 'assistant',
          content: 'Hi there! The time is 14:30:45',
        },
      ]);
    });

    it('should process array content messages with text parts', () => {
      const messages = [
        {
          id: '1',
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Hello {{username}}, today is {{date}}',
            },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,abc123' },
            },
          ],
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages, mockVariableGenerators);

      expect(result).toEqual([
        {
          id: '1',
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Hello TestUser, today is 2023-12-25',
            },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,abc123' },
            },
          ],
        },
      ]);
    });

    it('should skip messages without content', () => {
      const messages = [
        {
          id: '1',
          role: 'user',
        },
        {
          id: '2',
          role: 'assistant',
          content: null,
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages, mockVariableGenerators);

      expect(result).toEqual(messages);
    });

    it('should handle mixed content types', () => {
      const messages = [
        {
          id: '1',
          role: 'user',
          content: 'Simple {{username}} message',
        },
        {
          id: '2',
          role: 'user',
          content: [{ type: 'text', text: 'Complex {{date}} message' }],
        },
        {
          id: '3',
          role: 'assistant',
          content: { type: 'object', data: 'not processed' },
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages, mockVariableGenerators);

      expect(result).toEqual([
        {
          id: '1',
          role: 'user',
          content: 'Simple TestUser message',
        },
        {
          id: '2',
          role: 'user',
          content: [{ type: 'text', text: 'Complex 2023-12-25 message' }],
        },
        {
          id: '3',
          role: 'assistant',
          content: { type: 'object', data: 'not processed' },
        },
      ]);
    });
  });

  describe('PlaceholderVariablesProcessor', () => {
    it('should process messages through the processor', async () => {
      const processor = new PlaceholderVariablesProcessor({
        variableGenerators: mockVariableGenerators,
      });

      const context = {
        initialState: {
          messages: [],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: '',
          tools: [],
        },
        messages: [
          {
            id: '1',
            role: 'user',
            content: 'Hello {{username}}, today is {{date}}',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        metadata: {
          model: 'gpt-4',
          maxTokens: 4096,
        },
        isAborted: false,
        executedProcessors: [],
      };

      const result = await processor.process(context);

      expect(result.messages[0].content).toBe('Hello TestUser, today is 2023-12-25');
      expect(result.metadata.placeholderVariablesProcessed).toBe(1);
    });

    it('should handle processing errors gracefully', async () => {
      const faultyGenerators = {
        error: () => {
          throw new Error('Generator error');
        },
        working: () => 'works',
      };

      const processor = new PlaceholderVariablesProcessor({
        variableGenerators: faultyGenerators,
      });

      const context = {
        initialState: {
          messages: [],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: '',
          tools: [],
        },
        messages: [
          {
            id: '1',
            role: 'user',
            content: 'This {{working}} but this {{error}} fails',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        metadata: {
          model: 'gpt-4',
          maxTokens: 4096,
        },
        isAborted: false,
        executedProcessors: [],
      };

      // Should not throw, but continue processing
      const result = await processor.process(context);
      expect(result.messages).toHaveLength(1);
    });

    it('should use custom depth setting', async () => {
      const processor = new PlaceholderVariablesProcessor({
        variableGenerators: mockVariableGenerators,
        depth: 1,
      });

      const context = {
        initialState: {
          messages: [],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: '',
          tools: [],
        },
        messages: [
          {
            id: '1',
            role: 'user',
            content: 'Nested: {{nested}}',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        metadata: {
          model: 'gpt-4',
          maxTokens: 4096,
        },
        isAborted: false,
        executedProcessors: [],
      };

      const result = await processor.process(context);

      expect(result.messages[0].content).toBe('Nested: Value with {{date}} inside');
    });

    it('should not modify messages that do not need processing', async () => {
      const processor = new PlaceholderVariablesProcessor({
        variableGenerators: mockVariableGenerators,
      });

      const context = {
        initialState: {
          messages: [],
          model: 'gpt-4',
          provider: 'openai',
          systemRole: '',
          tools: [],
        },
        messages: [
          {
            id: '1',
            role: 'user',
            content: 'No variables here',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
        metadata: {
          model: 'gpt-4',
          maxTokens: 4096,
        },
        isAborted: false,
        executedProcessors: [],
      };

      const result = await processor.process(context);

      expect(result.metadata.placeholderVariablesProcessed).toBe(0);
    });
  });

  describe('formatPlaceholderValues & renderPlaceholderTemplate', () => {
    it('formats nested structures into strings', () => {
      const formatted = formatPlaceholderValues({
        empty: undefined,
        list: ['work', 'personal'],
        nested: ['alpha', ['beta']],
        number: 42,
      });

      expect(formatted.empty).toBe('');
      expect(formatted.list).toBe('work, personal');
      expect(formatted.nested).toBe('alpha, beta');
      expect(formatted.number).toBe('42');
    });

    it('renders template strings using provided values', () => {
      const template = 'Hello {{ name }}! Categories: {{ categories }}';
      const result = renderPlaceholderTemplate(template, {
        categories: ['work', 'personal'],
        name: 'World',
      });

      expect(result).toBe('Hello World! Categories: work, personal');
    });
  });
});
