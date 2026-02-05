import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parsePlaceholderVariables,
  parsePlaceholderVariablesMessages,
  VARIABLE_GENERATORS,
} from './index';

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

vi.mock('../GlobalAgentContextManager', () => ({
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

describe('parsePlaceholderVariables', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-06T06:06:06.666Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('basic variable replacement', () => {
    it('should replace a single variable', () => {
      const text = 'Hello {{username}}!';
      const result = parsePlaceholderVariables(text);
      expect(result).toBe('Hello testuser!');
    });

    it('should replace multiple variables', () => {
      const text = 'User: {{username}}, Email: {{email}}';
      const result = parsePlaceholderVariables(text);
      expect(result).toBe('User: testuser, Email: test@example.com');
    });

    it('should return original text if no variables present', () => {
      const text = 'Hello world!';
      const result = parsePlaceholderVariables(text);
      expect(result).toBe('Hello world!');
    });

    it('should handle empty string', () => {
      const result = parsePlaceholderVariables('');
      expect(result).toBe('');
    });

    it('should preserve unknown variables', () => {
      const text = 'Hello {{unknown_var}}!';
      const result = parsePlaceholderVariables(text);
      expect(result).toBe('Hello {{unknown_var}}!');
    });
  });

  describe('recursive depth handling', () => {
    it('should handle default depth of 2', () => {
      const text = 'Test {{username}}';
      const result = parsePlaceholderVariables(text);
      expect(result).toBe('Test testuser');
    });

    it('should handle custom depth', () => {
      const text = 'Test {{username}}';
      const result = parsePlaceholderVariables(text, 1);
      expect(result).toBe('Test testuser');
    });

    it('should handle depth of 0', () => {
      const text = 'Test {{username}}';
      const result = parsePlaceholderVariables(text, 0);
      // With depth 0, no replacements should occur
      expect(result).toBe('Test {{username}}');
    });

    it('should stop early if no more replacements needed', () => {
      const text = 'Static text';
      const result = parsePlaceholderVariables(text, 10);
      expect(result).toBe('Static text');
    });
  });

  describe('special characters and edge cases', () => {
    it('should handle variables with spaces', () => {
      const text = 'Hello {{ username }}!';
      const result = parsePlaceholderVariables(text);
      // The regex trims spaces, so this should work
      expect(result).toBe('Hello testuser!');
    });

    it('should handle consecutive variables', () => {
      const text = '{{username}}{{email}}';
      const result = parsePlaceholderVariables(text);
      expect(result).toBe('testusertest@example.com');
    });

    it('should handle variables at start and end', () => {
      const text = '{{username}} middle {{email}}';
      const result = parsePlaceholderVariables(text);
      expect(result).toBe('testuser middle test@example.com');
    });

    it('should handle malformed brackets', () => {
      const text = '{username} or {{{username}}}';
      const result = parsePlaceholderVariables(text);
      // Only {{username}} should be replaced
      expect(result).toContain('{username}');
    });
  });
});

describe('VARIABLE_GENERATORS', () => {
  describe('time-related variables', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-06-06T06:06:06.666Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should generate year', () => {
      expect(VARIABLE_GENERATORS.year()).toBe('2025');
    });

    it('should generate month with padding', () => {
      expect(VARIABLE_GENERATORS.month()).toBe('06');
    });

    it('should generate day with padding', () => {
      expect(VARIABLE_GENERATORS.day()).toBe('06');
    });

    it('should generate hour with padding', () => {
      // getHours() returns local time, so we need to mock it directly
      const spy = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(6);
      expect(VARIABLE_GENERATORS.hour()).toBe('06');
      spy.mockRestore();
    });

    it('should generate minute with padding', () => {
      expect(VARIABLE_GENERATORS.minute()).toBe('06');
    });

    it('should generate second with padding', () => {
      expect(VARIABLE_GENERATORS.second()).toBe('06');
    });

    it('should generate ISO timestamp', () => {
      expect(VARIABLE_GENERATORS.iso()).toBe('2025-06-06T06:06:06.666Z');
    });

    it('should generate timestamp', () => {
      const result = VARIABLE_GENERATORS.timestamp();
      expect(result).toBe(Date.now().toString());
    });

    it('should generate date string', () => {
      const result = VARIABLE_GENERATORS.date();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should generate time string', () => {
      const result = VARIABLE_GENERATORS.time();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should generate datetime string', () => {
      const result = VARIABLE_GENERATORS.datetime();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should generate weekday', () => {
      const result = VARIABLE_GENERATORS.weekday();
      expect(result).toBe('Friday');
    });

    it('should generate locale', () => {
      const result = VARIABLE_GENERATORS.locale();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should generate timezone', () => {
      const result = VARIABLE_GENERATORS.timezone();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });

  describe('random value variables', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should generate random number', () => {
      expect(VARIABLE_GENERATORS.random()).toBe('500001');
    });

    it('should generate random boolean', () => {
      expect(VARIABLE_GENERATORS.random_bool()).toBe('false');
    });

    it('should generate random float', () => {
      expect(VARIABLE_GENERATORS.random_float()).toBe('50.00');
    });

    it('should generate random integer', () => {
      expect(VARIABLE_GENERATORS.random_int()).toBe('51');
    });

    it('should generate random hex color', () => {
      const result = VARIABLE_GENERATORS.random_hex();
      // Math.floor(0.5 * 16777215) = 8388607 = 0x7fffff
      expect(result).toBe('7fffff');
      expect(result.length).toBe(6);
    });

    it('should generate random string', () => {
      const result = VARIABLE_GENERATORS.random_string();
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should generate random digit', () => {
      expect(VARIABLE_GENERATORS.random_digit()).toBe('5');
    });

    it('should generate different random booleans', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.6);
      expect(VARIABLE_GENERATORS.random_bool()).toBe('true');

      vi.spyOn(Math, 'random').mockReturnValue(0.4);
      expect(VARIABLE_GENERATORS.random_bool()).toBe('false');
    });
  });

  describe('UUID variables', () => {
    it('should generate full UUID', () => {
      expect(VARIABLE_GENERATORS.uuid()).toBe('mocked-uuid-12345');
    });

    it('should generate short UUID', () => {
      expect(VARIABLE_GENERATORS.uuid_short()).toBe('mocked');
    });
  });

  describe('user information variables', () => {
    it('should get username', () => {
      expect(VARIABLE_GENERATORS.username()).toBe('testuser');
    });

    it('should get nickname', () => {
      expect(VARIABLE_GENERATORS.nickname()).toBe('Test User');
    });

    it('should get email', () => {
      expect(VARIABLE_GENERATORS.email()).toBe('test@example.com');
    });
  });

  describe('model information variables', () => {
    it('should get current model', () => {
      expect(VARIABLE_GENERATORS.model()).toBe('gpt-4');
    });

    it('should get current provider', () => {
      expect(VARIABLE_GENERATORS.provider()).toBe('openai');
    });
  });

  describe('desktop path variables', () => {
    it('should get home path', () => {
      expect(VARIABLE_GENERATORS.homePath()).toBe('/Users/test');
    });

    it('should get desktop path', () => {
      expect(VARIABLE_GENERATORS.desktopPath()).toBe('/Users/test/Desktop');
    });

    it('should get documents path', () => {
      expect(VARIABLE_GENERATORS.documentsPath()).toBe('/Users/test/Documents');
    });

    it('should get downloads path', () => {
      expect(VARIABLE_GENERATORS.downloadsPath()).toBe('/Users/test/Downloads');
    });

    it('should return empty string for missing music path', () => {
      expect(VARIABLE_GENERATORS.musicPath()).toBe('');
    });

    it('should return empty string for missing pictures path', () => {
      expect(VARIABLE_GENERATORS.picturesPath()).toBe('');
    });

    it('should return empty string for missing videos path', () => {
      expect(VARIABLE_GENERATORS.videosPath()).toBe('');
    });

    it('should return empty string for missing userData path', () => {
      expect(VARIABLE_GENERATORS.userDataPath()).toBe('');
    });

    it('should return default message for working directory when not specified', () => {
      const result = VARIABLE_GENERATORS.workingDirectory();
      expect(result).toBe('(not specified, use user Desktop directory as default)');
    });
  });

  describe('platform variables', () => {
    const originalNavigator = global.navigator;

    beforeEach(() => {
      Object.defineProperty(global, 'navigator', {
        writable: true,
        configurable: true,
        value: {
          language: 'en-US',
          platform: 'MacIntel',
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        },
      });
    });

    afterEach(() => {
      Object.defineProperty(global, 'navigator', {
        writable: true,
        configurable: true,
        value: originalNavigator,
      });
    });

    it('should get language', () => {
      expect(VARIABLE_GENERATORS.language()).toBe('en-US');
    });

    it('should get platform', () => {
      expect(VARIABLE_GENERATORS.platform()).toBe('MacIntel');
    });

    it('should get user agent', () => {
      const result = VARIABLE_GENERATORS.user_agent();
      expect(result).toContain('Mozilla/5.0');
      expect(result).toContain('Chrome/132.0.0.0');
    });

    it('should return empty string when navigator is undefined', () => {
      Object.defineProperty(global, 'navigator', {
        writable: true,
        configurable: true,
        value: undefined,
      });

      expect(VARIABLE_GENERATORS.language()).toBe('');
      expect(VARIABLE_GENERATORS.platform()).toBe('');
      expect(VARIABLE_GENERATORS.user_agent()).toBe('');
    });
  });
});
