import { AsyncLocalStorage } from 'node:async_hooks';

const deadlineStorage = new AsyncLocalStorage<number>();

/**
 * Run `fn` knowing the host kills this invocation at `deadlineAt` (epoch ms),
 * so long waits inside it can stop in time to clean up after themselves.
 */
export const runWithInvocationDeadline = <T>(deadlineAt: number, fn: () => Promise<T>) =>
  deadlineStorage.run(deadlineAt, fn);

/** When the current invocation is killed, if its host declared it. */
export const getInvocationDeadline = (): number | undefined => deadlineStorage.getStore();
