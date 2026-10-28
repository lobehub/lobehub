import { mcpInvocationKey } from '@lobechat/mcp-elicitation/transport';
import { expect, it, vi } from 'vitest';

import { McpInvocationRegistry } from './mcpInvocation';

it('reattaches renderer replay to the in-flight result and retains its receipt', async () => {
  const registry = new McpInvocationRegistry();
  let finish!: (value: string) => void;
  const execute = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const one = registry.run('owner/op/call', 'args', Date.now() + 1000, execute);
  const two = registry.run('owner/op/call', 'args', Date.now() + 1000, execute);
  await Promise.resolve();
  expect(execute).toHaveBeenCalledOnce();
  finish('applied-once');
  await expect(one).resolves.toBe('applied-once');
  await expect(two).resolves.toBe('applied-once');
  await expect(registry.run('owner/op/call', 'args', Date.now() + 1000, execute)).resolves.toBe(
    'applied-once',
  );
  expect(execute).toHaveBeenCalledOnce();
  await expect(
    registry.run('owner/op/call', 'changed', Date.now() + 1000, execute),
  ).rejects.toThrow('different parameters');
});
it('never shares an invocation across operation or owner keys', async () => {
  const registry = new McpInvocationRegistry();
  const execute = vi.fn().mockResolvedValue('done');
  await Promise.all(
    ['alice/op/1', 'bob/op/1', 'alice/other/1'].map((key) =>
      registry.run(key, 'args', Date.now() + 1000, execute),
    ),
  );
  expect(execute).toHaveBeenCalledTimes(3);
});

it('executes two steps with the same provider id once each and rejoins only their own replays', async () => {
  const registry = new McpInvocationRegistry(),
    sideEffects: string[] = [];
  const base = { userId: 'owner', operationId: 'op', toolCallId: 'call_1' };
  const first = { ...base, assistantMessageId: 'one' },
    second = { ...base, assistantMessageId: 'two' };
  const invoke = (scope: typeof first) =>
    registry.run(mcpInvocationKey(scope), 'args', Date.now() + 1000, async () => {
      sideEffects.push(scope.assistantMessageId);
      return scope.assistantMessageId;
    });
  expect(await Promise.all([invoke(first), invoke(second), invoke(first), invoke(second)])).toEqual(
    ['one', 'two', 'one', 'two'],
  );
  expect(sideEffects).toEqual(['one', 'two']);
});

it('keeps a long native invocation receipt beyond seven minutes without replaying its remote effect', async () => {
  vi.useFakeTimers();
  try {
    const registry = new McpInvocationRegistry();
    const execute = vi.fn().mockResolvedValue('original receipt');
    const deadline = Date.now() + 600000;
    await registry.run('long', 'args', deadline, execute);
    await vi.advanceTimersByTimeAsync(420001);
    await expect(registry.run('long', 'args', deadline, execute)).resolves.toBe('original receipt');
    expect(execute).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
