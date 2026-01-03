import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parsePlaceholderVariablesMessages } from './index';

// Mock dependencies
vi.mock('@lobechat/utils', () => ({
  uuid: () => 'mocked-uuid-12345',
}));

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: () => ({}),
  },
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    displayUserName: () => 'testuser',
    nickName: () => 'Test User',
    fullName: () => 'Test Full Name',
    email: () => 'test@example.com',
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: {
    getState: () => ({}),
  },
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentModel: () => 'gpt-4',
    currentAgentModelProvider: () => 'openai',
    currentAgentWorkingDirectory: () => undefined,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({}),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentTopicWorkingDirectory: () => undefined,
  },
}));

vi.mock('./GlobalAgentContextManager', () => ({
  globalAgentContextManager: {
    getContext: () => ({
      homePath: '/Users/test',
      desktopPath: '/Users/test/Desktop',
      documentsPath: '/Users/test/Documents',
      downloadsPath: '/Users/test/Downloads',
    }),
  },
}));

describe('parsePlaceholderVariablesMessages', () => {
  beforeEach(() => {
    // Mock Date for consistent testing
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-06T06:06:06.666Z'));

    // Mock Math.random for consistent random values
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('string content messages', () => {
    it('should replace template variables in string content', () => {
      const messages = [
        {
          id: '1',
          content: 'Hello {{username}}, today is {{date}}',
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toContain('testuser');
      expect(result[0].content).toContain(new Date().toLocaleDateString());
    });

    it('should handle multiple variables in one message', () => {
      const messages = [
        {
          id: '1',
          content: 'Time: {{time}}, Date: {{date}}, User: {{nickname}}',
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toContain('Test User');
      expect(result[0].content).toMatch(/Time: .+, Date: .+, User: Test User/);
    });

    it('should preserve message structure when replacing variables', () => {
      const messages = [
        {
          id: '1',
          role: 'user',
          content: 'Hello {{username}}',
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0]).toEqual({
        id: '1',
        role: 'user',
        content: 'Hello testuser',
      });
    });
  });

  describe('array content messages', () => {
    it('should replace variables in text type array elements', () => {
      const messages = [
        {
          id: '1',
          content: [
            {
              type: 'text',
              text: 'Hello {{username}}',
            },
            {
              type: 'image_url',
              image_url: 'image.jpg',
            },
          ],
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content[0].text).toBe('Hello testuser');
      expect(result[0].content[1]).toEqual({
        type: 'image_url',
        image_url: 'image.jpg',
      });
    });

    it('should handle multiple text elements with variables', () => {
      const messages = [
        {
          id: '1',
          content: [
            {
              type: 'text',
              text: 'Date: {{date}}',
            },
            {
              type: 'text',
              text: 'Time: {{time}}',
            },
            {
              type: 'image_url',
              image_url: 'test.jpg',
            },
          ],
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content[0].text).toContain(new Date().toLocaleDateString());
      expect(result[0].content[1].text).toContain(new Date().toLocaleTimeString());
      expect(result[0].content[2]).toEqual({
        type: 'image_url',
        image_url: 'test.jpg',
      });
    });

    it('should preserve non-text array elements unchanged', () => {
      const messages = [
        {
          id: '1',
          content: [
            {
              type: 'image_url',
              image_url: 'image.jpg',
            },
            {
              type: 'image_url',
              name: 'image2.jpg',
            },
          ],
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toEqual([
        {
          type: 'image_url',
          image_url: 'image.jpg',
        },
        {
          type: 'image_url',
          name: 'image2.jpg',
        },
      ]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty messages array', () => {
      const result = parsePlaceholderVariablesMessages([]);
      expect(result).toEqual([]);
    });

    it('should handle messages without content', () => {
      const messages = [{ id: '1' }, { id: '2', content: null }, { id: '3', content: undefined }];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result).toEqual([
        { id: '1' },
        { id: '2', content: null },
        { id: '3', content: undefined },
      ]);
    });

    it('should handle empty string content', () => {
      const messages = [{ id: '1', content: '' }];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toBe('');
    });

    it('should handle content without variables', () => {
      const messages = [
        { id: '1', content: 'Hello world!' },
        {
          id: '2',
          content: [
            { type: 'text', text: 'No variables here' },
            { type: 'image_url', image_url: 'test.jpg' },
          ],
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toBe('Hello world!');
      expect(result[1].content[0].text).toBe('No variables here');
    });

    it('should handle unknown variable types', () => {
      const messages = [{ id: '1', content: 'Hello {{unknown_variable}}!' }];

      const result = parsePlaceholderVariablesMessages(messages);

      // Unknown variables should remain unchanged
      expect(result[0].content).toBe('Hello {{unknown_variable}}!');
    });
  });

  describe('specific variable types', () => {
    it('should handle time variables', () => {
      const messages = [
        {
          id: '1',
          content: 'Year: {{year}}, Month: {{month}}, Day: {{day}}',
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toContain('Year: 2025');
      expect(result[0].content).toContain('Month: 06');
      expect(result[0].content).toContain('Day: 06');
    });

    it('should handle random variables', () => {
      const messages = [
        {
          id: '1',
          content: 'Random: {{random}}, Bool: {{random_bool}}, UUID: {{uuid}}',
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toContain('Random: 500001'); // Math.random() * 1000000 + 1 with 0.5
      expect(result[0].content).toContain('Bool: false'); // Math.random() > 0.5 with 0.5
      expect(result[0].content).toContain('UUID: mocked-uuid-12345');
    });

    it('should handle user variables', () => {
      const messages = [
        {
          id: '1',
          content: 'User: {{username}}, Nickname: {{nickname}}',
        },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toBe('User: testuser, Nickname: Test User');
    });
  });

  describe('multiple messages', () => {
    it('should process multiple messages correctly', () => {
      const messages = [
        { id: '1', content: 'Hello {{username}}' },
        {
          id: '2',
          content: [{ type: 'text', text: 'Today is {{date}}' }],
        },
        { id: '3', content: 'Time: {{time}}' },
      ];

      const result = parsePlaceholderVariablesMessages(messages);

      expect(result[0].content).toBe('Hello testuser');
      expect(result[1].content[0].text).toContain(new Date().toLocaleDateString());
      expect(result[2].content).toContain(new Date().toLocaleTimeString());
    });
  });
});
