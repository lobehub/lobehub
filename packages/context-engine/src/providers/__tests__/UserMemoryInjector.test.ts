import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { UserMemoryInjector } from '../UserMemoryInjector';

describe('UserMemoryInjector', () => {
  const createContext = (messages: any[] = []): PipelineContext => ({
    initialState: {
      messages: [],
      model: 'gpt-4',
      provider: 'openai',
    },
    isAborted: false,
    messages,
    metadata: {
      maxTokens: 4096,
      model: 'gpt-4',
    },
  });

  describe('basic injection', () => {
    it('should inject user memories before the first user message', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [
            { description: 'Test context description', id: 'ctx-1', title: 'Test Context' },
          ],
          experiences: [],
          preferences: [],
        },
      });

      const context = createContext([
        { content: 'System prompt', id: 'sys-1', role: 'system' },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].meta?.systemInjection).toBe(true);
      expect(result.messages[1].content).toMatchSnapshot();
      expect(result.messages[2].content).toBe('Hello');
      expect(result.metadata.userMemoryInjected).toBe(true);
    });

    it('should skip injection when memories is undefined', async () => {
      const provider = new UserMemoryInjector({});

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello');
    });

    it('should skip injection when all memory arrays are empty', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [],
          experiences: [],
          preferences: [],
        },
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello');
    });

    it('should skip injection when no user messages exist', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [{ description: 'Test', id: 'ctx-1', title: 'Test' }],
          experiences: [],
          preferences: [],
        },
      });

      const context = createContext([{ content: 'System prompt', id: 'sys-1', role: 'system' }]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('system');
    });
  });

  describe('memory types', () => {
    it('should inject contexts correctly', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [
            { description: 'Context 1 description', id: 'ctx-1', title: 'Context 1' },
            { description: 'Context 2 description', id: 'ctx-2', title: 'Context 2' },
          ],
          experiences: [],
          preferences: [],
        },
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
    });

    it('should inject experiences correctly', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [],
          experiences: [
            { id: 'exp-1', keyLearning: 'Learning 1', situation: 'Situation 1' },
            { id: 'exp-2', keyLearning: 'Learning 2', situation: 'Situation 2' },
          ],
          preferences: [],
        },
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
    });

    it('should inject preferences correctly', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [],
          experiences: [],
          preferences: [
            { conclusionDirectives: 'Prefer TypeScript', id: 'pref-1' },
            { conclusionDirectives: 'Use dark mode', id: 'pref-2' },
          ],
        },
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
    });

    it('should inject all memory types together', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [{ description: 'Context desc', id: 'ctx-1', title: 'Context' }],
          experiences: [{ id: 'exp-1', keyLearning: 'Learning', situation: 'Situation' }],
          preferences: [{ conclusionDirectives: 'Preference', id: 'pref-1' }],
        },
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
    });
  });

  describe('XML format', () => {
    it('should handle null or undefined values gracefully', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [{ description: null, id: undefined, title: null }],
          experiences: [{ id: undefined, keyLearning: null, situation: null }],
          preferences: [{ conclusionDirectives: null, id: undefined }],
        },
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.messages[0].content).toMatchSnapshot();
    });
  });

  describe('integration with BaseFirstUserContentProvider', () => {
    it('should append to existing system injection message', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [{ description: 'Test', id: 'ctx-1', title: 'Test' }],
          experiences: [],
          preferences: [],
        },
      });

      const context = createContext([
        { content: 'System prompt', id: 'sys-1', role: 'system' },
        {
          content: 'Existing injection content',
          id: 'inject-1',
          meta: { systemInjection: true },
          role: 'user',
        },
        { content: 'Hello', id: 'user-1', role: 'user' },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[1].content).toMatchSnapshot();
    });

    it('should work with multimodal messages', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [{ description: 'Test', id: 'ctx-1', title: 'Test' }],
          experiences: [],
          preferences: [],
        },
      });

      const context = createContext([
        {
          content: [
            { text: 'Hello with image', type: 'text' },
            { image_url: { url: 'http://example.com/img.png' }, type: 'image_url' },
          ],
          id: 'user-1',
          role: 'user',
        },
      ]);

      const result = await provider.process(context);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].meta?.systemInjection).toBe(true);
      expect(result.messages[0].content).toMatchSnapshot();
    });
  });

  describe('metadata', () => {
    it('should set userMemoryInjected to true when memories exist', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [{ description: 'Test', id: 'ctx-1', title: 'Test' }],
          experiences: [],
          preferences: [],
        },
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      expect(result.metadata.userMemoryInjected).toBe(true);
    });

    it('should set userMemoryInjected when config has memories even if empty', async () => {
      const provider = new UserMemoryInjector({
        memories: {
          contexts: [],
          experiences: [],
          preferences: [],
        },
      });

      const context = createContext([{ content: 'Hello', id: 'user-1', role: 'user' }]);

      const result = await provider.process(context);

      // memories exists in config, so metadata is set
      expect(result.metadata.userMemoryInjected).toBe(true);
    });
  });
});
