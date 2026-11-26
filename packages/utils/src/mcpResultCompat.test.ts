import { describe, expect, it, vi } from 'vitest';

import { installMcpResultCompat, withMcpRawResult } from './mcpResultCompat';

const createTransport = () => {
  const sent: unknown[] = [];
  const transport = {
    onmessage: undefined as ((message: any, extra?: any) => void) | undefined,
    send: vi.fn(async (message: unknown) => {
      sent.push(message);
    }),
  };
  return { sent, transport };
};

/** Connect the way the SDK's Protocol does: chain the pre-set handler, then dispatch. */
const connect = (transport: { onmessage?: (message: any, extra?: any) => void }) => {
  const received: any[] = [];
  const preset = transport.onmessage;
  transport.onmessage = (message, extra) => {
    preset?.(message, extra);
    received.push(structuredClone(message));
  };
  return received;
};

describe('installMcpResultCompat', () => {
  it('fills missing caching hints on a 2026-07-28 listing and warns once per method', async () => {
    const { transport } = createTransport();
    const onWarning = vi.fn();
    installMcpResultCompat(transport, { onWarning });
    const received = connect(transport);

    for (const id of [1, 2]) {
      await transport.send({ id, jsonrpc: '2.0', method: 'tools/list' });
      transport.onmessage!({
        id,
        jsonrpc: '2.0',
        result: { resultType: 'complete', tools: [{ inputSchema: {}, name: 'echo' }] },
      });
    }

    expect(received.map((message) => message.result)).toEqual([
      expect.objectContaining({ cacheScope: 'private', ttlMs: 0 }),
      expect.objectContaining({ cacheScope: 'private', ttlMs: 0 }),
    ]);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('tools/list'));
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('ttlMs, cacheScope'));
  });

  it('replaces invalid hints and keeps valid ones', async () => {
    const { transport } = createTransport();
    installMcpResultCompat(transport);
    const received = connect(transport);

    await transport.send({ id: 'a', jsonrpc: '2.0', method: 'prompts/list' });
    transport.onmessage!({
      id: 'a',
      jsonrpc: '2.0',
      result: { cacheScope: 'shared', prompts: [], resultType: 'complete', ttlMs: 60_000 },
    });

    expect(received[0].result).toMatchObject({ cacheScope: 'private', ttlMs: 60_000 });
  });

  it('leaves earlier-revision results, other methods and input_required results alone', async () => {
    const { transport } = createTransport();
    const onWarning = vi.fn();
    installMcpResultCompat(transport, { onWarning });
    const received = connect(transport);

    await transport.send({ id: 1, jsonrpc: '2.0', method: 'tools/list' });
    transport.onmessage!({ id: 1, jsonrpc: '2.0', result: { tools: [] } });
    await transport.send({ id: 2, jsonrpc: '2.0', method: 'tools/call' });
    transport.onmessage!({
      id: 2,
      jsonrpc: '2.0',
      result: { content: [], resultType: 'complete' },
    });
    await transport.send({ id: 3, jsonrpc: '2.0', method: 'tools/list' });
    transport.onmessage!({
      id: 3,
      jsonrpc: '2.0',
      result: { requestState: 'x', resultType: 'input_required' },
    });

    expect(received.map((message) => message.result)).toEqual([
      { tools: [] },
      { content: [], resultType: 'complete' },
      { requestState: 'x', resultType: 'input_required' },
    ]);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('keeps an excerpt of list results only, truncated', async () => {
    const { transport } = createTransport();
    const compat = installMcpResultCompat(transport);
    connect(transport);

    await transport.send({ id: 1, jsonrpc: '2.0', method: 'tools/list' });
    transport.onmessage!({
      id: 1,
      jsonrpc: '2.0',
      result: { tools: [{ description: 'x'.repeat(2000), name: 'big' }] },
    });
    await transport.send({ id: 2, jsonrpc: '2.0', method: 'resources/read' });
    transport.onmessage!({ id: 2, jsonrpc: '2.0', result: { contents: [{ text: 'secret' }] } });

    const excerpt = compat.rawResultExcerpt('tools/list');
    expect(excerpt).toMatch(/^\{"tools":\[\{"description":"x+/);
    expect(excerpt!.length).toBeLessThan(700);
    expect(excerpt!.endsWith('…')).toBe(true);
    expect(compat.rawResultExcerpt('resources/read')).toBeUndefined();
  });

  it('works on a transport without send, and forwards every message', () => {
    const preset = vi.fn();
    const transport = { onmessage: preset } as any;
    installMcpResultCompat(transport);

    transport.onmessage({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }, { x: 1 });

    expect(preset).toHaveBeenCalledWith(
      { jsonrpc: '2.0', method: 'notifications/tools/list_changed' },
      { x: 1 },
    );
  });
});

describe('withMcpRawResult', () => {
  const invalidResult = () =>
    Object.assign(new Error('Invalid result for tools/list: bad'), { code: 'INVALID_RESULT' });

  it('appends the raw result to an SDK INVALID_RESULT error', async () => {
    const { transport } = createTransport();
    const compat = installMcpResultCompat(transport);
    connect(transport);
    await transport.send({ id: 1, jsonrpc: '2.0', method: 'tools/list' });
    transport.onmessage!({ id: 1, jsonrpc: '2.0', result: { tools: [{ name: 'echo' }] } });

    const original = invalidResult();
    const error = withMcpRawResult(original, compat, 'tools/list') as Error;

    expect(error.message).toBe(
      'Invalid result for tools/list: bad\nServer response (truncated): {"tools":[{"name":"echo"}]}',
    );
    expect(error.cause).toBe(original);
  });

  it('returns any other error, or one without a captured result, unchanged', () => {
    const { transport } = createTransport();
    const compat = installMcpResultCompat(transport);
    const other = new Error('fetch failed');
    const invalid = invalidResult();

    expect(withMcpRawResult(other, compat, 'tools/list')).toBe(other);
    expect(withMcpRawResult(invalid, compat, 'tools/list')).toBe(invalid);
    expect(withMcpRawResult(invalid, undefined, 'tools/list')).toBe(invalid);
  });
});
