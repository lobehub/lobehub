import { afterEach, expect, it, vi } from 'vitest';

import { McpCompletionDelivery } from './mcpCompletionDelivery';
import { McpInvocationRegistry } from './mcpInvocation';

afterEach(() => vi.useRealTimers());

it('retries a lost completion ACK independently of the already completed native invocation', async () => {
  vi.useFakeTimers();
  const invocations = new McpInvocationRegistry();
  const deliveries = new McpCompletionDelivery();
  const execute = vi.fn().mockResolvedValue('saved once');
  const publish = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('network'))
    .mockRejectedValueOnce(new Error('HTTP 503'))
    .mockResolvedValue(true);
  const deadline = Date.now() + 10000;
  const receipt = await invocations.run('owner/invocation', 'args', deadline, execute);
  expect(receipt).toBe('saved once');
  const first = deliveries.deliver('owner/invocation', deadline, publish);
  expect(deliveries.deliver('owner/invocation', deadline, publish)).toBe(first);
  await vi.advanceTimersByTimeAsync(1500);
  await first;
  expect(publish).toHaveBeenCalledTimes(3);
  await expect(invocations.run('owner/invocation', 'args', deadline, execute)).resolves.toBe(
    'saved once',
  );
  expect(execute).toHaveBeenCalledOnce();
});

it('stops delivery when the owner binding is revoked or its deadline expires', async () => {
  vi.useFakeTimers();
  const delivery = new McpCompletionDelivery();
  const revoked = vi.fn().mockResolvedValue(false);
  await delivery.deliver('revoked', Date.now() + 10000, revoked);
  const failing = vi.fn().mockRejectedValue(new Error('offline'));
  const pending = delivery.deliver('offline', Date.now() + 501, failing);
  await vi.advanceTimersByTimeAsync(10000);
  await pending;
  expect(revoked).toHaveBeenCalledOnce();
  expect(failing).toHaveBeenCalledTimes(2);
});
