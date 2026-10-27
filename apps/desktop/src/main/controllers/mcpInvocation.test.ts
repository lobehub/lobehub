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
