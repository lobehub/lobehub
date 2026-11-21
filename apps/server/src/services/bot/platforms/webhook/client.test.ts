// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const { fetchCappedBuffer } = vi.hoisted(() => ({ fetchCappedBuffer: vi.fn() }));

vi.mock('../loadAttachmentBuffer', () => ({ fetchCappedBuffer }));
vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {},
  updateBotRuntimeStatus: vi.fn(),
}));

const { BotWebhookClientFactory } = await import('./client');

const makeClient = () =>
  new BotWebhookClientFactory().createClient(
    {
      applicationId: 'my-bot',
      credentials: {
        callbackUrl: 'https://example.com/callback',
        signingSecret: 's'.repeat(40),
      },
      platform: 'webhook',
      settings: {},
    },
    {} as any,
  );

const attachment = (index: number) => ({
  raw: { name: `f${index}.png`, type: 'image', url: `https://cdn.example.com/f${index}.png` },
});

describe('BotWebhookClient.extractFiles', () => {
  it('downloads a message’s attachments a few at a time, not all at once', async () => {
    let inFlight = 0;
    let peak = 0;
    fetchCappedBuffer.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return Buffer.from('img');
    });

    const files = await makeClient().extractFiles!({
      attachments: Array.from({ length: 10 }, (_, index) => attachment(index)),
    } as any);

    expect(fetchCappedBuffer).toHaveBeenCalledTimes(10);
    expect(peak).toBeLessThanOrEqual(3);
    expect(files).toHaveLength(10);
  });

  it('drops only the attachment whose download failed, keeping order', async () => {
    fetchCappedBuffer.mockReset();
    fetchCappedBuffer.mockImplementation(async (url: string) =>
      url.endsWith('f1.png') ? undefined : Buffer.from(url),
    );

    const files = await makeClient().extractFiles!({
      attachments: [attachment(0), attachment(1), attachment(2)],
    } as any);

    expect(files?.map((file) => file.name)).toEqual(['f0.png', 'f2.png']);
  });
});
