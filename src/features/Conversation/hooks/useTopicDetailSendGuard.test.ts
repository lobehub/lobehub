/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import { ensureTopicBeforeRun, useTopicDetailSendGuard } from './useTopicDetailSendGuard';

const refreshTopicDetail = vi.fn();

describe('ensureTopicBeforeRun', () => {
  beforeEach(() => {
    refreshTopicDetail.mockReset();
    act(() =>
      useChatStore.setState({
        activeAgentId: 'agt_cook',
        refreshTopicDetail,
        topicDataMap: {},
        topicDetailMap: {},
      } as any),
    );
  });

  /**
   * @example Codex review: a send on a first visit to a project topic ran with
   * the agent's default model and routing, because the topic row had not
   * reached the store yet.
   */
  it('reads the detail of a topic the store does not hold before the run starts', async () => {
    const order: string[] = [];
    refreshTopicDetail.mockImplementation(async () => {
      await Promise.resolve();
      order.push('detail');
    });

    await ensureTopicBeforeRun('tpc_new').then(() => order.push('run'));

    expect(refreshTopicDetail).toHaveBeenCalledWith('tpc_new', true);
    expect(order).toEqual(['detail', 'run']);
  });

  it('does not refetch a topic the store already holds', async () => {
    act(() => useChatStore.setState({ topicDetailMap: { tpc_known: { id: 'tpc_known' } } } as any));

    await ensureTopicBeforeRun('tpc_known');
    await ensureTopicBeforeRun(undefined);

    expect(refreshTopicDetail).not.toHaveBeenCalled();
  });

  it('lets the run through when the detail cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    refreshTopicDetail.mockRejectedValue(new Error('offline'));

    await expect(ensureTopicBeforeRun('tpc_new')).resolves.toBeUndefined();

    consoleError.mockRestore();
  });
});

describe('useTopicDetailSendGuard', () => {
  beforeEach(() => {
    refreshTopicDetail.mockReset();
    act(() =>
      useChatStore.setState({
        refreshTopicDetail,
        topicDataMap: {},
        topicDetailMap: {},
      } as any),
    );
  });

  it('guards every generation on the current topic and never blocks it', async () => {
    const { result, rerender } = renderHook(({ topicId }) => useTopicDetailSendGuard(topicId), {
      initialProps: { topicId: 'tpc_a' as string | undefined },
    });
    const hooks = result.current;
    rerender({ topicId: 'tpc_b' });

    await expect(hooks.onBeforeSendMessage!({} as any)).resolves.toBeUndefined();
    await hooks.onBeforeRegenerate!('msg_1');
    await hooks.onBeforeContinue!('msg_1');

    expect(result.current).toBe(hooks);
    expect(refreshTopicDetail.mock.calls).toEqual([
      ['tpc_b', true],
      ['tpc_b', true],
      ['tpc_b', true],
    ]);
  });
});
