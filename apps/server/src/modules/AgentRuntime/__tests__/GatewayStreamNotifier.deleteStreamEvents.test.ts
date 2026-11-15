import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayStreamNotifier } from '../GatewayStreamNotifier';
import { createMockInner } from '../testUtils';

const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
vi.stubGlobal('fetch', mockFetch);

describe('GatewayStreamNotifier.deleteStreamEvents', () => {
  let inner: ReturnType<typeof createMockInner>;
  let notifier: GatewayStreamNotifier;

  beforeEach(() => {
    mockFetch.mockClear();
    inner = createMockInner();
    notifier = new GatewayStreamNotifier(inner, 'https://gateway.test.com', 'test-token');
  });

  // Removal only trims stored history; clients already received the entries live.
  it('delegates to inner without pushing to the gateway', async () => {
    await notifier.deleteStreamEvents('op-1', ['1-0']);

    expect(inner.calls.deleteStreamEvents).toEqual([['op-1', ['1-0']]]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
