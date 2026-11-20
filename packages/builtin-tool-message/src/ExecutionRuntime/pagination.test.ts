import { describe, expect, it, vi } from 'vitest';

import type { ReadMessagesParams } from '../types';
import { MessageExecutionRuntime } from './index';

const message = (id: string) => ({
  id,
  timestamp: '2026-09-27T00:00:00Z',
  author: { id: 'u', name: 'Test' },
  content: 'synthetic',
});
const setup = (ids: string[], extra = {}) => {
  const state = { messages: ids.map(message), ...extra };
  const readMessages = vi.fn().mockResolvedValue(state);
  const searchMessages = vi.fn().mockResolvedValue(state);
  return {
    state,
    readMessages,
    runtime: new MessageExecutionRuntime({ service: { readMessages, searchMessages } as any }),
  };
};
const params = { platform: 'discord' as const, channelId: 'synthetic-channel' };
const nextArgs = (content: string) =>
  JSON.parse(content.match(/call readMessages with (\{[^\n]+?\})\./)![1]);

describe('model-visible message pagination', () => {
  it('preserves string IDs, context, contents and state without numeric precision loss', async () => {
    const ids = ['1553422647705083935', '1553422647705083934', '1553422647705083936'];
    const { runtime, state } = setup(ids, { privateInternal: 'DO_NOT_PROJECT' });
    const out = await runtime.readMessages(params);
    expect(out.success).toBe(true);
    expect(out.state).toBe(state);
    for (const id of ids) expect(out.content).toContain(`[messageId: "${id}"]`);
    expect(out.content).toContain('discord:synthetic-channel');
    expect(out.content).toContain('Test: synthetic');
    expect(out.content).not.toContain('DO_NOT_PROJECT');
    expect(nextArgs(out.content)).toEqual({ ...params, before: ids[1] });
    expect(out.content.indexOf('Discord pagination')).toBeLessThan(
      out.content.indexOf('Test: synthetic'),
    );
  });

  it.each([1, 49, 50, 51, 99, 100, 101])(
    'does not assert more/end from a %i-message page',
    async (size) => {
      const ids = Array.from({ length: size }, (_, i) =>
        (1553422647705083900n + BigInt(i)).toString(),
      ).reverse();
      const { runtime } = setup(ids);
      const out = await runtime.readMessages(params);
      expect(out.content).toContain('More messages are unknown, regardless of page size');
      expect(nextArgs(out.content).before).toBe(ids.at(-1));
    },
  );

  it('continues before toward oldest even with unsorted IDs', async () => {
    const { runtime } = setup(['102', '100', '101']);
    expect(nextArgs((await runtime.readMessages({ ...params, before: '103' })).content)).toEqual({
      ...params,
      before: '100',
    });
  });

  it('continues after toward newest even with unsorted IDs', async () => {
    const { runtime } = setup(['102', '100', '101']);
    expect(nextArgs((await runtime.readMessages({ ...params, after: '99' })).content)).toEqual({
      ...params,
      after: '102',
    });
  });

  it.each([{}, { before: '103' }, { after: '99' }])(
    'keeps the bounded readMessages budget and CLI fallback for %j',
    async (cursor) => {
      const { runtime } = setup(['102', '100', '101']);
      const out = await runtime.readMessages({ ...params, ...cursor });
      expect(out.content).toContain('Within the 3–5-call readMessages budget');
      expect(out.content).toContain('For large-volume requests or tasks needing more calls');
      expect(out.content).toContain('use the lobehub skill');
      expect(out.content).toContain('lh bot message read');
      expect(out.content).not.toContain('continue until');
    },
  );

  describe.each(['before', 'after'] as const)('Discord %s input', (direction) => {
    it.each(['', ' ', ' 100 ', '100\n', '100\r', 'bad-id', '-1', '1.5', '1e3', null, 100])(
      'rejects invalid cursor %j before fetching a page',
      async (cursor) => {
        const { runtime, readMessages } = setup(['102', '100', '101']);
        const input: ReadMessagesParams = {
          ...params,
          [direction]: cursor as ReadMessagesParams[typeof direction],
        };
        const out = await runtime.readMessages(input);
        expect(out.success).toBe(false);
        expect(out.content).toContain(
          `Discord ${direction} must be a non-empty decimal message ID string`,
        );
        expect(out.content).not.toContain('call readMessages with');
        expect(out.state).toBeUndefined();
        expect(readMessages).not.toHaveBeenCalled();
      },
    );

    it('accepts an explicitly undefined cursor as omitted', async () => {
      const { runtime } = setup(['102', '100', '101']);
      const out = await runtime.readMessages({ ...params, [direction]: undefined });
      expect(out.success).toBe(true);
      expect(nextArgs(out.content)).toEqual({ ...params, before: '100' });
    });
  });

  it.each([{ before: '100' }, { after: '102' }])(
    'blocks nonadvancing cursor %j',
    async (cursor) => {
      const { runtime } = setup(['102', '100', '101']);
      const out = await runtime.readMessages({ ...params, ...cursor });
      expect(out.content).toContain('cursor did not advance');
      expect(out.content).not.toContain('call readMessages with');
    },
  );

  it('rejects simultaneous Discord cursors without calling the service', async () => {
    const { runtime, readMessages } = setup([]);
    const out = await runtime.readMessages({ ...params, before: '102', after: '100' });
    expect(out.success).toBe(false);
    expect(readMessages).not.toHaveBeenCalled();
  });

  it('a successful empty page only ends current visible traversal', async () => {
    const messages: ReturnType<typeof message>[] = [];
    const { runtime } = setup([], { messages });
    const out = await runtime.readMessages(params);
    expect(out.content).toContain('Stop this traversal of visible history');
    expect(out.content).toContain('does not prove');
    expect(out.content).not.toContain('call readMessages with');
  });

  it('does not mistake a missing message page for exhaustion', async () => {
    const { runtime } = setup([], { messages: undefined });
    const out = await runtime.readMessages(params);
    expect(out.content).toContain('Pagination blocked');
    expect(out.content).not.toContain('Stop this traversal');
  });

  it('preserves an explicit page size in the continuation', async () => {
    const { runtime } = setup(['101']);
    const out = await runtime.readMessages({ ...params, limit: 1 });
    expect(nextArgs(out.content)).toEqual({ ...params, before: '101', limit: 1 });
  });

  it.each(['403 Missing Access', '429 rate limited'])(
    'does not mistake %s for exhaustion',
    async (error) => {
      const { runtime, readMessages } = setup([]);
      readMessages.mockRejectedValue(new Error(error));
      const out = await runtime.readMessages(params);
      expect(out.success).toBe(false);
      expect(out.content).toContain(error);
      expect(out.content).not.toContain('Stop this traversal');
    },
  );

  it.each(['bad-id', Number('1553422647705083934')])(
    'does not invent cursor for invalid ID %s',
    async (id) => {
      const { runtime } = setup([], { messages: [message(id as any)] });
      expect((await runtime.readMessages(params)).content).toContain('Pagination blocked');
    },
  );

  it.each(['feishu', 'lark', 'slack', 'telegram', 'wechat', 'qq', 'imessage'] as const)(
    'preserves %s opaque cursor behavior',
    async (platform) => {
      const { runtime, readMessages } = setup(['opaque-id'], {
        hasMore: true,
        nextCursor: 'opaque-token',
      });
      const input = { ...params, platform, cursor: 'prior-token', before: '', after: '' };
      const out = await runtime.readMessages(input);
      expect(readMessages).toHaveBeenCalledWith(input);
      expect(out.content).toContain('[messageId: "opaque-id"]');
      expect(out.content).toContain('pass cursor: "opaque-token"');
      expect(out.content).not.toContain('Discord pagination');
    },
  );

  it('does not synthesize cursors for other platforms without hasMore', async () => {
    const { runtime } = setup(['opaque-id'], { hasMore: false, nextCursor: 'unused' });
    expect((await runtime.readMessages({ ...params, platform: 'feishu' })).content).not.toContain(
      'pass cursor:',
    );
  });

  it('search exposes IDs but does not present search hits as a history page', async () => {
    const { runtime } = setup(['1553422647705083934']);
    const out = await runtime.searchMessages({ ...params, query: 'synthetic' });
    expect(out.content).toContain('[messageId: "1553422647705083934"]');
    expect(out.content).not.toContain('Discord pagination');
  });

  it('two synthetic pages: second before is derived solely from model-visible content', async () => {
    const { runtime, readMessages } = setup(['1553422647705083936', '1553422647705083935']);
    const first = await runtime.readMessages(params);
    const secondArgs = nextArgs(first.content);
    readMessages.mockResolvedValueOnce({ messages: [message('1553422647705083934')] });
    const second = await runtime.readMessages(secondArgs);
    expect(readMessages).toHaveBeenLastCalledWith({ ...params, before: '1553422647705083935' });
    expect(nextArgs(second.content).before).toBe('1553422647705083934');
  });
});
