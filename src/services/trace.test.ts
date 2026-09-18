import { TraceEventType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { traceService } from './trace';

const mocks = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/store/user', () => ({ useUserStore: { getState: () => ({}) } }));
vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: { telemetry: () => mocks.enabled },
  userProfileSelectors: { userId: () => 'user-1' },
}));

beforeEach(() => {
  mocks.enabled = true;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response()));
});
afterEach(() => vi.unstubAllGlobals());

describe('feedback telemetry consent and attributes', () => {
  const data = {
    eventType: TraceEventType.CopyMessage as const,
    traceId: 'trace-1',
    observationId: 'observation-1',
    sessionId: 'topic-1',
    content: 'hello',
  };
  it('does not send feedback without user opt-in', async () => {
    mocks.enabled = false;
    await traceService.traceEvent(data);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends user/session context with the original feedback IDs', async () => {
    await traceService.traceEvent(data);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ ...data, userId: 'user-1' }) }),
    );
  });
});
