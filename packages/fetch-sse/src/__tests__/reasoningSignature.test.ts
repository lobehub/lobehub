import type { FetchEventSourceInit } from '@lobechat/utils/client/fetchEventSource/index';
import { fetchEventSource } from '@lobechat/utils/client/fetchEventSource/index';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSSE } from '../fetchSSE';

vi.mock('@lobechat/model-runtime', () => ({
  parseToolCalls: vi.fn(),
}));

vi.mock('@lobechat/utils/client/fetchEventSource/index', () => ({
  fetchEventSource: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSSE reasoning signatures', () => {
  it('should preserve a reasoning signature without visible reasoning text', async () => {
    const mockOnFinish = vi.fn();

    (fetchEventSource as any).mockImplementationOnce(
      (url: string, options: FetchEventSourceInit) => {
        options.onopen!({ clone: () => ({ ok: true, headers: new Headers() }) } as any);
        options.onmessage!({
          data: JSON.stringify('encrypted-reasoning-content'),
          event: 'reasoning_signature',
        } as any);
        options.onmessage!({ data: JSON.stringify('Done'), event: 'text' } as any);
      },
    );

    await fetchSSE('/', {
      onFinish: mockOnFinish,
      responseAnimation: 'fadeIn',
    });

    expect(mockOnFinish).toHaveBeenCalledWith('Done', {
      observationId: null,
      reasoning: {
        content: undefined,
        signature: 'encrypted-reasoning-content',
      },
      toolCalls: undefined,
      traceId: null,
      type: 'done',
    });
  });
});
