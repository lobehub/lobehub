import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isMessageListKey, workKeys } from '@/libs/swr/keys';

const mutate = vi.fn();

vi.mock('@/libs/swr', () => ({
  mutate: (...args: unknown[]) => mutate(...args),
}));

// work.ts imports the lambda client at module load; stub it so the service
// module resolves without a real tRPC client.
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { work: {} },
}));

// Imported after the mocks so the service binds to the stubbed `mutate`.
const { didToolMutateWorkView, workService } = await import('./work');

beforeEach(() => {
  mutate.mockClear();
});

describe('didToolMutateWorkView', () => {
  it('detects a Work registration intent', () => {
    expect(
      didToolMutateWorkView({
        apiName: 'createIssue',
        identifier: 'linear',
        succeeded: true,
        workRegistration: true,
      }),
    ).toBe(true);
  });

  it('detects task status mutations without a Work registration intent', () => {
    expect(
      didToolMutateWorkView({
        apiName: 'updateTaskStatus',
        identifier: 'lobe-task',
        succeeded: true,
        workRegistration: false,
      }),
    ).toBe(true);
  });

  it('detects a partially successful runTasks result', () => {
    expect(
      didToolMutateWorkView({
        apiName: 'runTasks',
        identifier: 'lobe-task',
        result: { state: { succeeded: 1 } },
        succeeded: false,
        workRegistration: false,
      }),
    ).toBe(true);

    expect(
      didToolMutateWorkView({
        apiName: 'runTasks',
        identifier: 'lobe-task',
        succeeded: false,
        workRegistration: false,
      }),
    ).toBe(true);
  });

  it('ignores read-only and failed task calls', () => {
    expect(
      didToolMutateWorkView({
        apiName: 'listTasks',
        identifier: 'lobe-task',
        succeeded: true,
        workRegistration: false,
      }),
    ).toBe(false);
    expect(
      didToolMutateWorkView({
        apiName: 'updateTaskStatus',
        identifier: 'lobe-task',
        succeeded: false,
        workRegistration: false,
      }),
    ).toBe(false);
  });
});

describe('workService.refreshConversation', () => {
  it('refreshes messages, history, and mounted version timelines once per operation', async () => {
    await workService.refreshConversation('t1', 'th1');

    expect(mutate).toHaveBeenCalledTimes(3);
    expect(mutate).toHaveBeenCalledWith(workKeys.conversation('t1', 'th1'));

    const matchers = mutate.mock.calls
      .map(([key]) => key)
      .filter((key): key is (cacheKey: unknown) => boolean => typeof key === 'function');
    expect(matchers.some((matcher) => matcher(['message:list', { topicId: 't1' }, 1]))).toBe(true);
    expect(matchers.some((matcher) => matcher(workKeys.versions('w1')))).toBe(true);
  });
});

describe('workService.refreshConversationViews', () => {
  it('refreshes the conversation history key and the mounted version timelines', async () => {
    await workService.refreshConversationViews('t1', 'th1');

    expect(mutate).toHaveBeenCalledTimes(2);
    // History list: exact conversation key.
    expect(mutate).toHaveBeenCalledWith(workKeys.conversation('t1', 'th1'));
    // Expanded version timelines: a matcher over the `work:versions` root.
    const versionMatcher = mutate.mock.calls[1][0] as (key: unknown) => boolean;
    expect(typeof versionMatcher).toBe('function');
    expect(versionMatcher(workKeys.versions('w1'))).toBe(true);
    expect(versionMatcher(workKeys.conversation('t1', 'th1'))).toBe(false);
  });

  it('normalizes a missing threadId to null in the conversation key', async () => {
    await workService.refreshConversationViews('t1');

    expect(mutate).toHaveBeenCalledWith(workKeys.conversation('t1', null));
  });

  it('never refreshes the message list or the workspace gallery', async () => {
    await workService.refreshConversationViews('t1', null);

    const versionMatcher = mutate.mock.calls[1][0] as (key: unknown) => boolean;
    // The version matcher must not select message-list or cross-topic gallery keys —
    // Work summaries ride the message payload, and the gallery is out of scope here.
    expect(isMessageListKey(['message:list', { topicId: 't1' }, 1])).toBe(true);
    expect(versionMatcher(['message:list', { topicId: 't1' }, 1])).toBe(false);
    expect(versionMatcher(workKeys.workspace(null, 'all', null))).toBe(false);
  });

  it('is a no-op without a topicId', async () => {
    await workService.refreshConversationViews(null, 'th1');
    await workService.refreshConversationViews(undefined);

    expect(mutate).not.toHaveBeenCalled();
  });
});
