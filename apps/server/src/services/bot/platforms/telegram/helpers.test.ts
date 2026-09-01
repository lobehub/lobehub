import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTelegramWebhook, TELEGRAM_ALLOWED_UPDATES } from './helpers';

describe('setTelegramWebhook', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to Guest Mode and native stop updates', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    await setTelegramWebhook('123:token', 'https://example.com/hook', 'secret');

    expect(TELEGRAM_ALLOWED_UPDATES).toContain('guest_message');
    expect(TELEGRAM_ALLOWED_UPDATES).toContain('stopped_message_generation');
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.allowed_updates).toContain('guest_message');
    expect(body.allowed_updates).toContain('stopped_message_generation');
    expect(body.secret_token).toBe('secret');
    expect(body.url).toBe('https://example.com/hook');
  });
});
