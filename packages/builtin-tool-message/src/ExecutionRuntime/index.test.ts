import { describe, expect, it, vi } from 'vitest';

import { MessageExecutionRuntime } from './index';

const runtimeWith = (sendMessage: ReturnType<typeof vi.fn>) =>
  new MessageExecutionRuntime({ service: { sendMessage } as any });

describe('MessageExecutionRuntime.sendMessage', () => {
  it('keeps the plain success line when every attachment landed', async () => {
    const runtime = runtimeWith(
      vi.fn().mockResolvedValue({
        attachmentsDelivered: 1,
        channelId: 'c1',
        messageId: 'm1',
        platform: 'discord',
      }),
    );

    const output = await runtime.sendMessage({
      attachments: [{ fetchUrl: 'https://x/a.png', type: 'image' }],
      channelId: 'c1',
      content: 'hi',
      platform: 'discord',
    });

    expect(output.success).toBe(true);
    expect(output.content).toBe('Message sent to discord:c1 (messageId: m1)');
  });

  it('names every attachment that was NOT delivered, with the reason, so the model stops claiming it was', async () => {
    // Regression: the docx never left the server, the tool said `success: true`
    // with no further detail, and the model replied "docx attached 📄".
    const runtime = runtimeWith(
      vi.fn().mockResolvedValue({
        attachmentFailures: [
          {
            detail: 'fetch failed: fetch failed (Invalid IP address: undefined)',
            name: 'report.docx',
            reason: 'source-unavailable',
            type: 'file',
          },
        ],
        attachmentsDelivered: 0,
        channelId: 'u1',
        platform: 'wechat',
      }),
    );

    const output = await runtime.sendMessage({
      attachments: [{ fetchUrl: 'https://app/f/file_1', name: 'report.docx', type: 'file' }],
      channelId: 'u1',
      content: 'see attached',
      platform: 'wechat',
    });

    // The text leg reached the user, so the call is not a failure...
    expect(output.success).toBe(true);
    // ...but the result must say what did not.
    expect(output.content).toContain('WARNING: 1 of 1 attachment(s) were NOT delivered');
    expect(output.content).toContain(
      '- "report.docx" (file): source-unavailable — fetch failed: fetch failed (Invalid IP address: undefined)',
    );
    expect(output.content).toContain('Do NOT claim these files were attached');
    expect(output.state).toMatchObject({ attachmentsDelivered: 0 });
  });

  it('fails the call when there was no text and no attachment reached the user', async () => {
    const runtime = runtimeWith(
      vi.fn().mockResolvedValue({
        attachmentFailures: [{ name: 'a.png', reason: 'upload-failed', type: 'image' }],
        attachmentsDelivered: 0,
        channelId: 'c1',
        platform: 'telegram',
      }),
    );

    const output = await runtime.sendMessage({
      attachments: [{ data: 'AAAA', name: 'a.png', type: 'image' }],
      channelId: 'c1',
      content: '',
      platform: 'telegram',
    });

    expect(output.success).toBe(false);
    expect(output.content).toMatch(/^Nothing was delivered\./);
    expect(output.content).not.toContain('Message sent');
    expect(output.content).toContain('No text or embed was given');
  });

  it('counts a delivered embed as delivery when there is no text and every attachment failed', async () => {
    // Discord posts the embed on the text leg even with empty content, so the
    // user did receive something — only the attachment is missing.
    const runtime = runtimeWith(
      vi.fn().mockResolvedValue({
        attachmentFailures: [{ name: 'chart.png', reason: 'source-unavailable', type: 'image' }],
        attachmentsDelivered: 0,
        channelId: 'c1',
        messageId: 'm1',
        platform: 'discord',
      }),
    );

    const output = await runtime.sendMessage({
      attachments: [{ fetchUrl: 'https://x/chart.png', name: 'chart.png', type: 'image' }],
      channelId: 'c1',
      content: '',
      embeds: [{ title: 'Weekly report' }],
      platform: 'discord',
    });

    expect(output.success).toBe(true);
    expect(output.content).toMatch(/^Message sent to discord:c1/);
    expect(output.content).toContain('- "chart.png" (image): source-unavailable');
    expect(output.content).not.toContain('Nothing was delivered');
  });

  it('still reports partial loss when some attachments landed', async () => {
    const runtime = runtimeWith(
      vi.fn().mockResolvedValue({
        attachmentFailures: [{ name: 'b.pdf', reason: 'upload-failed', type: 'file' }],
        attachmentsDelivered: 1,
        channelId: 'c1',
        platform: 'slack',
      }),
    );

    const output = await runtime.sendMessage({
      attachments: [
        { data: 'AAAA', name: 'a.png', type: 'image' },
        { data: 'AAAA', name: 'b.pdf', type: 'file' },
      ],
      channelId: 'c1',
      content: '',
      platform: 'slack',
    });

    expect(output.success).toBe(true);
    expect(output.content).toContain('WARNING: 1 of 2 attachment(s) were NOT delivered');
    expect(output.content).toContain('- "b.pdf" (file): upload-failed');
  });
});
