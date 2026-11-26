import { describe, expect, it, vi } from 'vitest';

import { MessageExecutionRuntime } from './index';
import type { MessageRuntimeService } from './types';

const runtimeWith = (service: Partial<MessageRuntimeService>) =>
  new MessageExecutionRuntime({ service: service as MessageRuntimeService });

const base = { channelId: 'c1', platform: 'discord' };

// [method, params, what the adapter returns, the line the model reads]
const cases: [keyof MessageRuntimeService, any, any, string][] = [
  ['editMessage', { ...base, content: 'x', messageId: 'm1' }, {}, 'Message m1 edited successfully'],
  ['deleteMessage', { ...base, messageId: 'm1' }, {}, 'Message m1 deleted successfully'],
  [
    'reactToMessage',
    { ...base, emoji: '👍', messageId: 'm1' },
    {},
    'Reacted with 👍 to message m1',
  ],
  [
    'getReactions',
    { ...base, messageId: 'm1' },
    { reactions: [{ count: 2, emoji: '👍' }] },
    'Reactions on message m1: 👍: 2',
  ],
  ['pinMessage', { ...base, messageId: 'm1' }, {}, 'Message m1 pinned in discord:c1'],
  ['unpinMessage', { ...base, messageId: 'm1' }, {}, 'Message m1 unpinned'],
  ['listPins', base, { messages: [{}, {}] }, '2 pinned messages in discord:c1'],
  [
    'getChannelInfo',
    base,
    { memberCount: 5, name: 'general', type: 'text' },
    'Channel: general (type: text, members: 5)',
  ],
  [
    'getMemberInfo',
    { ...base, memberId: 'u1' },
    { displayName: 'Arvin', status: 'online' },
    'Member: Arvin (status: online)',
  ],
  [
    'createThread',
    { ...base, content: 'x', name: 'Bug' },
    { threadId: 't1' },
    'Thread "Bug" created (threadId: t1)',
  ],
  [
    'createPoll',
    { ...base, options: ['a', 'b'], question: 'Ship?' },
    { pollId: 'p1' },
    'Poll "Ship?" created in discord:c1 (pollId: p1)',
  ],
];

describe('ChannelMessageRuntime', () => {
  it.each(cases)(
    '%s turns the adapter result into one line',
    async (method, params, result, line) => {
      const fn = vi.fn().mockResolvedValue(result);
      const output = await (runtimeWith({ [method]: fn }) as any)[method](params);

      expect(fn).toHaveBeenCalledWith(params);
      expect(output.success).toBe(true);
      expect(output.content).toContain(line);
    },
  );

  it.each(cases)('%s reports an adapter error instead of throwing', async (method, params) => {
    const output = await (
      runtimeWith({
        [method]: vi.fn().mockRejectedValue(new Error('rate limited')),
      }) as any
    )[method](params);

    expect(output).toEqual({ content: `${method} error: rate limited`, success: false });
  });

  it('lists channels and threads', async () => {
    const runtime = runtimeWith({
      listChannels: vi.fn().mockResolvedValue({ channels: [{ id: 'c1', name: 'general' }] }),
      listThreads: vi.fn().mockResolvedValue({ threads: [{ id: 't1', name: 'Bug' }] }),
    });

    expect((await runtime.listChannels({ platform: 'discord' })).content).toMatch(
      /^1 channels found on discord/,
    );
    expect((await runtime.listThreads(base)).content).toMatch(/^1 threads in discord:c1/);
  });

  it('says when a platform has no document or DM API', async () => {
    const runtime = runtimeWith({});

    expect(await runtime.readDocument({ platform: 'discord', url: 'https://x' } as any)).toEqual({
      content: 'readDocument is not supported on discord',
      success: false,
    });
    expect(
      (await runtime.sendDirectMessage({ content: 'hi', platform: 'discord', userId: 'u1' }))
        .success,
    ).toBe(false);
  });

  it('reports the Bitable link, sharing and non-fatal warnings', async () => {
    const createBitable = vi.fn().mockResolvedValue({
      appToken: 'bascnABC',
      collaborators: ['ou_1'],
      issues: [{ error: 'Access denied', target: 'ou_2' }],
      name: '待办',
      recordIds: ['rec1', 'rec2'],
      tableId: 'tblNew',
      url: 'https://x.feishu.cn/base/bascnABC',
    });
    const runtime = runtimeWith({ createBitable });
    const params = {
      collaborators: [{ openId: 'ou_1' }, { openId: 'ou_2' }],
      fields: [{ name: '任务', type: 'text' as const }],
      name: '待办',
      platform: 'feishu' as const,
    };

    const output = await runtime.createBitable(params);

    expect(createBitable).toHaveBeenCalledWith(params);
    expect(output.success).toBe(true);
    expect(output.content).toContain('URL: https://x.feishu.cn/base/bascnABC');
    expect(output.content).toContain('Records written: 2');
    expect(output.content).toContain('Shared with: ou_1');
    expect(output.content).toContain('Warning (ou_2): Access denied');
  });

  it('warns when a new Bitable is shared with nobody', async () => {
    const runtime = runtimeWith({
      createBitable: vi.fn().mockResolvedValue({ appToken: 'bascnABC', collaborators: [] }),
    });

    const output = await runtime.createBitable({
      fields: [{ name: '任务', type: 'text' }],
      name: '待办',
      platform: 'feishu',
    });

    expect(output.content).toContain('only the bot app can open it');
  });

  it('validates Bitable calls and reports unsupported platforms', async () => {
    const createBitable = vi.fn();
    const addBitableRecords = vi.fn().mockResolvedValue({
      appToken: 'bascnABC',
      recordIds: ['rec1'],
      tableId: 'tblX',
    });
    const runtime = runtimeWith({ addBitableRecords, createBitable });

    expect(
      (await runtime.createBitable({ fields: [], name: '待办', platform: 'feishu' })).success,
    ).toBe(false);
    expect(createBitable).not.toHaveBeenCalled();
    expect(
      (await runtime.addBitableRecords({ platform: 'feishu', records: [{ a: 1 }] })).content,
    ).toMatch(/pass the Bitable `url`/);
    expect(
      (await runtime.addBitableRecords({ appToken: 'bascnABC', platform: 'feishu', records: [] }))
        .content,
    ).toMatch(/`records` is empty/);
    expect(
      (
        await runtime.addBitableRecords({
          appToken: 'bascnABC',
          platform: 'feishu',
          records: [{ 任务: 'a' }],
        })
      ).content,
    ).toBe('Added 1 record(s) to Bitable bascnABC (table tblX)');

    const unsupported = runtimeWith({});
    expect(
      await unsupported.createBitable({
        fields: [{ name: 'a', type: 'text' }],
        name: 'x',
        platform: 'slack',
      }),
    ).toEqual({ content: 'createBitable is not supported on slack', success: false });
    expect(
      await unsupported.addBitableRecords({ appToken: 'x', platform: 'slack', records: [{}] }),
    ).toEqual({ content: 'addBitableRecords is not supported on slack', success: false });
  });

  it('reports a Bitable adapter error instead of throwing', async () => {
    const runtime = runtimeWith({
      createBitable: vi.fn().mockRejectedValue(new Error('scope missing')),
    });

    expect(
      await runtime.createBitable({
        fields: [{ name: 'a', type: 'text' }],
        name: 'x',
        platform: 'feishu',
      }),
    ).toEqual({ content: 'createBitable error: scope missing', success: false });
  });

  it('rejects conflicting or malformed Discord cursors before calling the adapter', async () => {
    const readMessages = vi.fn();
    const runtime = runtimeWith({ readMessages });

    expect((await runtime.readMessages({ ...base, after: '2', before: '1' })).content).toMatch(
      /mutually exclusive/,
    );
    expect((await runtime.readMessages({ ...base, before: 'abc' })).content).toMatch(
      /decimal message ID/,
    );
    expect(readMessages).not.toHaveBeenCalled();
  });
});
