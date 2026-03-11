import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { DiscordContextProvider } from '../DiscordContextProvider';

describe('DiscordContextProvider', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  // Helper: extract injected content string from result
  const getInjectedContent = (result: PipelineContext, index = 0): string =>
    result.messages[index].content as string;

  describe('Basic Scenarios', () => {
    it('should inject discord context before first user message', async () => {
      const provider = new DiscordContextProvider({
        context: {
          channel: { id: '789', name: 'general', topic: 'General discussion', type: 0 },
          guild: { id: '123456' },
        },
        enabled: true,
      });

      const input: any[] = [
        { content: 'You are a helpful assistant.', role: 'system' },
        { content: 'Hello', role: 'user' },
      ];

      const result = await provider.process(createContext(input));

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].content).toBe('You are a helpful assistant.');
      expect(result.messages[1].role).toBe('user');
      expect(getInjectedContent(result, 1)).toBe(`<discord_context>
  <guild id="123456" />
  <channel id="789" name="general" type="0" topic="General discussion" />
</discord_context>`);
      expect(result.messages[2].content).toBe('Hello');
    });

    it('should inject guild with name', async () => {
      const provider = new DiscordContextProvider({
        context: {
          channel: { id: '789', name: 'dev' },
          guild: { id: '123', name: 'My Server' },
        },
        enabled: true,
      });

      const input: any[] = [{ content: 'Hi', role: 'user' }];
      const result = await provider.process(createContext(input));

      expect(getInjectedContent(result)).toBe(`<discord_context>
  <guild id="123" name="My Server" />
  <channel id="789" name="dev" />
</discord_context>`);
    });

    it('should skip injection when disabled', async () => {
      const provider = new DiscordContextProvider({
        context: {
          channel: { id: '789', name: 'general' },
          guild: { id: '123' },
        },
        enabled: false,
      });

      const input: any[] = [
        { content: 'System', role: 'system' },
        { content: 'Hello', role: 'user' },
      ];

      const result = await provider.process(createContext(input));
      expect(result.messages).toHaveLength(2);
    });

    it('should skip injection when context is undefined', async () => {
      const provider = new DiscordContextProvider({ enabled: true });

      const input: any[] = [{ content: 'Hello', role: 'user' }];
      const result = await provider.process(createContext(input));
      expect(result.messages).toHaveLength(1);
    });

    it('should skip injection when both guild and channel are undefined', async () => {
      const provider = new DiscordContextProvider({
        context: {},
        enabled: true,
      });

      const input: any[] = [{ content: 'Hello', role: 'user' }];
      const result = await provider.process(createContext(input));
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('Partial Context', () => {
    it('should inject only guild when channel is missing', async () => {
      const provider = new DiscordContextProvider({
        context: { guild: { id: '123', name: 'Server' } },
        enabled: true,
      });

      const input: any[] = [{ content: 'Hello', role: 'user' }];
      const result = await provider.process(createContext(input));

      expect(result.messages).toHaveLength(2);
      expect(getInjectedContent(result)).toBe(`<discord_context>
  <guild id="123" name="Server" />
</discord_context>`);
    });

    it('should inject only channel when guild is missing', async () => {
      const provider = new DiscordContextProvider({
        context: { channel: { id: '789', name: 'general', type: 0 } },
        enabled: true,
      });

      const input: any[] = [{ content: 'Hello', role: 'user' }];
      const result = await provider.process(createContext(input));

      expect(result.messages).toHaveLength(2);
      expect(getInjectedContent(result)).toBe(`<discord_context>
  <channel id="789" name="general" type="0" />
</discord_context>`);
    });

    it('should handle channel with only id', async () => {
      const provider = new DiscordContextProvider({
        context: {
          channel: { id: '789' },
          guild: { id: '123' },
        },
        enabled: true,
      });

      const input: any[] = [{ content: 'Hello', role: 'user' }];
      const result = await provider.process(createContext(input));

      expect(getInjectedContent(result)).toBe(`<discord_context>
  <guild id="123" />
  <channel id="789" />
</discord_context>`);
    });
  });

  describe('Attribute Handling', () => {
    it('should include topic when provided', async () => {
      const provider = new DiscordContextProvider({
        context: {
          channel: { id: '789', topic: 'Bug reports only' },
          guild: { id: '123' },
        },
        enabled: true,
      });

      const input: any[] = [{ content: 'Hello', role: 'user' }];
      const result = await provider.process(createContext(input));

      expect(getInjectedContent(result)).toBe(`<discord_context>
  <guild id="123" />
  <channel id="789" topic="Bug reports only" />
</discord_context>`);
    });

    it('should include type=0 (falsy but valid)', async () => {
      const provider = new DiscordContextProvider({
        context: {
          channel: { id: '789', type: 0 },
          guild: { id: '123' },
        },
        enabled: true,
      });

      const input: any[] = [{ content: 'Hello', role: 'user' }];
      const result = await provider.process(createContext(input));

      expect(getInjectedContent(result)).toBe(`<discord_context>
  <guild id="123" />
  <channel id="789" type="0" />
</discord_context>`);
    });
  });

  describe('Message Consolidation', () => {
    it('should append to existing system injection message', async () => {
      const provider = new DiscordContextProvider({
        context: {
          channel: { id: '789', name: 'general' },
          guild: { id: '123' },
        },
        enabled: true,
      });

      const input: any[] = [
        { content: 'System role', role: 'system' },
        {
          content: 'Previous injected content',
          meta: { systemInjection: true },
          role: 'user',
        },
        { content: 'Hello', role: 'user' },
      ];

      const result = await provider.process(createContext(input));

      // Should NOT create a new message — should append to existing injection
      expect(result.messages).toHaveLength(3);
      expect(getInjectedContent(result, 1)).toBe(`Previous injected content

<discord_context>
  <guild id="123" />
  <channel id="789" name="general" />
</discord_context>`);
    });

    it('should skip when no user message exists', async () => {
      const provider = new DiscordContextProvider({
        context: {
          channel: { id: '789' },
          guild: { id: '123' },
        },
        enabled: true,
      });

      const input: any[] = [{ content: 'System only', role: 'system' }];
      const result = await provider.process(createContext(input));

      expect(result.messages).toHaveLength(1);
    });
  });
});
