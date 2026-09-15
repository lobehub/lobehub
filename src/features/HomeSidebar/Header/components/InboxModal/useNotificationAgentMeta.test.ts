import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationAgentMeta } from './useNotificationAgentMeta';

const mocks = vi.hoisted(() => ({
  useAgentDisplayMeta: vi.fn(),
}));

vi.mock('@/features/AgentTasks/shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: mocks.useAgentDisplayMeta,
}));

describe('useNotificationAgentMeta', () => {
  beforeEach(() => {
    mocks.useAgentDisplayMeta.mockReset().mockReturnValue(undefined);
  });

  it('renders the metadata agent snapshot when the agent is not loaded client-side', () => {
    // Scheduled-task rows deep-link to /task/:id, so the actionUrl carries no
    // agent segment — before the metadata.agent snapshot this resolved to
    // undefined and the row fell back to the product logo.
    const { result } = renderHook(() =>
      useNotificationAgentMeta('/task/tsk_1', {
        agent: {
          avatar: 'https://cdn.example/cron-bot.png',
          backgroundColor: '#abcdef',
          id: 'agt_1',
          name: 'Cron Bot',
        },
      }),
    );

    expect(mocks.useAgentDisplayMeta).toHaveBeenCalledWith('agt_1', { fallbackToDefault: false });
    expect(result.current).toEqual({
      avatar: 'https://cdn.example/cron-bot.png',
      backgroundColor: '#abcdef',
      title: 'Cron Bot',
    });
  });

  it('prefers live store meta over the send-time snapshot', () => {
    const liveMeta = { avatar: '🤖', backgroundColor: '#fff', title: 'Renamed Bot' };
    mocks.useAgentDisplayMeta.mockReturnValue(liveMeta);

    const { result } = renderHook(() =>
      useNotificationAgentMeta('/task/tsk_1', {
        agent: { avatar: 'https://cdn.example/stale.png', id: 'agt_1' },
      }),
    );

    expect(result.current).toEqual(liveMeta);
  });

  it('falls back to the default avatar when the snapshot has none', () => {
    const { result } = renderHook(() =>
      useNotificationAgentMeta('/task/tsk_1', { agent: { id: 'agt_1' } }),
    );

    expect(result.current?.avatar).toBeTruthy();
  });

  it('still resolves the agent from an /agent/:id actionUrl without a snapshot', () => {
    renderHook(() => useNotificationAgentMeta('/agent/agt_2/chat', null));

    expect(mocks.useAgentDisplayMeta).toHaveBeenCalledWith('agt_2', { fallbackToDefault: false });
  });

  it('returns undefined without any agent identity (product logo fallback)', () => {
    const { result } = renderHook(() => useNotificationAgentMeta('/task/tsk_1', null));

    expect(mocks.useAgentDisplayMeta).toHaveBeenCalledWith(undefined, { fallbackToDefault: false });
    expect(result.current).toBeUndefined();
  });
});
