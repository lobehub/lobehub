import { readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PiRpcOperationContext } from './piRpcOperationContext';
import type { PiRpcCommand, PiRpcResponse } from './piRpcProtocol';

const contexts: PiRpcOperationContext[] = [];
const createContext = () => {
  const context = new PiRpcOperationContext();
  contexts.push(context);
  return context;
};

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  vi.useRealTimers();
});

describe('Pi operation context', () => {
  it('requires matching instance, action and turn confirmation, not ordinary RPC success', async () => {
    vi.useFakeTimers();
    const context = createContext();
    const other = createContext();
    const send = vi.fn().mockResolvedValue({ type: 'response', command: 'prompt', success: true });
    const done = vi.fn();
    const pending = context.update('set', 'operation-B', send).then(done);
    const request = {
      type: 'extension_ui_request' as const,
      method: 'setStatus' as const,
      id: 'ui',
      statusKey: other.commandName,
      statusText: '{"action":"set","sequence":1}',
    };
    expect(context.consume(request)).toBe(false);
    context.consume({
      ...request,
      statusKey: context.commandName,
      statusText: '{"action":"clear","sequence":1}',
    });
    context.consume({
      ...request,
      statusKey: context.commandName,
      statusText: '{"action":"set","sequence":0}',
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(done).not.toHaveBeenCalled();
    context.consume({ ...request, statusKey: context.commandName });
    await pending;
    expect(done).toHaveBeenCalledOnce();
    const rejected = context.update('clear', null, send);
    const assertion = expect(rejected).rejects.toThrow('acknowledgment timed out');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('executes the shipped extension with isolated env, changing identity across turns and rejecting stale cleanup', async () => {
    const load = async () => {
      const context = createContext();
      await context.prepare();
      const env: Record<string, string> = {};
      let handler!: (args: string, ctx: unknown) => Promise<void>;
      const source = await readFile(context.path, 'utf8');
      const install = runInNewContext(`(${source.replace('export default ', '')})`, {
        process: { env },
      });
      install({
        registerCommand: (_name: string, options: { handler: typeof handler }) =>
          (handler = options.handler),
      });
      const extensionCtx = {
        isIdle: () => true,
        ui: {
          setStatus: (statusKey: string, statusText: string) =>
            context.consume({
              type: 'extension_ui_request',
              method: 'setStatus',
              id: 'status',
              statusKey,
              statusText,
            }),
        },
      };
      const send = async (command: PiRpcCommand): Promise<PiRpcResponse> => {
        if (command.type !== 'prompt') throw new Error('Unexpected command');
        await handler(command.message.slice(command.message.indexOf(' ') + 1), extensionCtx);
        return { type: 'response', command: 'prompt', success: true };
      };
      return { context, env, extensionCtx, handler, send };
    };
    const [a, b] = await Promise.all([load(), load()]);
    await Promise.all([
      a.context.update('set', 'topic-A-turn-1', a.send),
      b.context.update('set', 'topic-B-turn-1', b.send),
    ]);
    expect(a.env.LOBEHUB_OPERATION_ID).toBe('topic-A-turn-1');
    expect(b.env.LOBEHUB_OPERATION_ID).toBe('topic-B-turn-1');
    await a.context.update('clear', null, a.send);
    expect(a.env.LOBEHUB_OPERATION_ID).toBeUndefined();
    await a.context.update('set', 'topic-A-turn-2', a.send);
    await expect(a.handler('{"action":"clear","sequence":1}', a.extensionCtx)).rejects.toThrow(
      'Stale operation cleanup',
    );
    expect(a.env.LOBEHUB_OPERATION_ID).toBe('topic-A-turn-2');
    expect(b.env.LOBEHUB_OPERATION_ID).toBe('topic-B-turn-1');
    await a.context.update('clear', null, a.send);
    await a.context.update('set', '', a.send);
    expect(a.env.LOBEHUB_OPERATION_ID).toBe('');
    await a.context.update('clear', null, a.send);
    await a.context.update('set', null, a.send);
    expect(a.env.LOBEHUB_OPERATION_ID).toBeUndefined();
  });

  it('cancels pending confirmation and removes resources even during preparation', async () => {
    const context = createContext();
    const preparation = context.prepare();
    const update = context.update('set', 'op', async () => ({
      type: 'response',
      command: 'prompt',
      success: true,
    }));
    const rejected = expect(update).rejects.toThrow('closed');
    await context.dispose();
    await Promise.all([preparation, rejected]);
    await expect(stat(context.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
