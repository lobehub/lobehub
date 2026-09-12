import { describe, expect, it } from 'vitest';

import { getSendMessagePresentation, resolveDeliveryStatus } from './delivery';
import type { SendMessageAttachmentOutcome, SendMessageDelivery } from './types';

const acceptedImage = { index: 0, status: 'accepted', type: 'image' } as const;
const failedImage = {
  index: 0,
  reason: 'upload_failed',
  status: 'failed',
  type: 'image',
} as const;
const fallbackImage = {
  index: 0,
  reason: 'over_budget',
  status: 'link_fallback',
  type: 'image',
} as const;
const unknownImage = {
  index: 0,
  reason: 'send_unconfirmed',
  status: 'unknown',
  type: 'image',
} as const;

describe('resolveDeliveryStatus', () => {
  it.each<{
    attachments: SendMessageAttachmentOutcome[];
    name: string;
    status: SendMessageDelivery['status'];
    text: SendMessageDelivery['text'];
  }>([
    { attachments: [], name: 'text only', status: 'accepted', text: { status: 'accepted' } },
    {
      attachments: [acceptedImage],
      name: 'media only',
      status: 'accepted',
      text: { status: 'not_requested' },
    },
    {
      attachments: [failedImage],
      name: 'text accepted and media failed',
      status: 'partial',
      text: { status: 'accepted' },
    },
    {
      attachments: [failedImage],
      name: 'all media failed',
      status: 'failed',
      text: { status: 'not_requested' },
    },
    {
      attachments: [fallbackImage],
      name: 'link fallback',
      status: 'degraded',
      text: { status: 'accepted' },
    },
    {
      attachments: [fallbackImage, { ...failedImage, index: 1 }],
      name: 'link accepted and other media failed',
      status: 'partial',
      text: { status: 'not_requested' },
    },
    {
      attachments: [unknownImage, { ...failedImage, index: 1 }],
      name: 'uncertain submission with accepted text and failed media',
      status: 'unknown',
      text: { status: 'accepted' },
    },
    {
      attachments: [
        { index: 0, reason: 'text_not_accepted', status: 'not_attempted', type: 'file' },
      ],
      name: 'uncertain text prevents attachments',
      status: 'unknown',
      text: { reason: 'text_send_unconfirmed', status: 'unknown' },
    },
    {
      attachments: [
        fallbackImage,
        { index: 1, reason: 'prior_failure', status: 'not_attempted', type: 'file' },
      ],
      name: 'accepted link and unattempted media',
      status: 'partial',
      text: { status: 'not_requested' },
    },
    { attachments: [], name: 'empty request', status: 'failed', text: { status: 'not_requested' } },
  ])('$name is $status', ({ attachments, status, text }) => {
    expect(resolveDeliveryStatus({ attachments, text })).toBe(status);
  });
});

describe('getSendMessagePresentation', () => {
  it.each<SendMessageDelivery['status']>(['accepted', 'degraded', 'partial', 'failed', 'unknown'])(
    'keeps %s feedback consistent with the structured report',
    (status) => {
      const attachments = {
        accepted: [acceptedImage],
        degraded: [fallbackImage],
        failed: [failedImage],
        partial: [failedImage],
        unknown: [unknownImage],
      }[status];
      const delivery: SendMessageDelivery = {
        attachments,
        receipt: 'unconfirmed',
        status,
        text: { status: status === 'failed' ? 'not_requested' : 'accepted' },
      };
      const result = getSendMessagePresentation({
        channelId: 'fixture',
        delivery,
        platform: 'wechat',
      });

      expect(result).toMatchObject({ status, success: status === 'accepted' });
      expect(result.content).toContain(JSON.stringify(delivery, null, 2));
      expect(result.content).toContain('Recipient receipt is unconfirmed');
      expect(result.content).not.toContain('undefined');
      if (status !== 'accepted') {
        expect(result.content).toContain('Do not resend the entire request');
        expect(result.content).not.toContain('Message sent');
      }
      if (status === 'degraded') expect(result.content).toContain('download links');
    },
  );

  it('reports old WeChat results as unconfirmed', () => {
    expect(getSendMessagePresentation({ channelId: 'fixture', platform: 'wechat' })).toMatchObject({
      content: expect.stringContaining('did not provide per-item send results'),
      status: 'unknown',
      success: false,
    });
  });

  it('uses the requested platform when an old server omits it', () => {
    expect(
      getSendMessagePresentation({}, { channelId: 'fixture', platform: 'wechat' }),
    ).toMatchObject({
      content: expect.stringContaining('wechat:fixture'),
      status: 'unknown',
      success: false,
    });
  });

  it.each(['discord', 'telegram', 'slack', 'feishu'])(
    'preserves legacy %s success and the returned message ID',
    (platform) => {
      expect(
        getSendMessagePresentation({ channelId: 'fixture', messageId: 'actual-id', platform }),
      ).toEqual({
        content: `Message sent to ${platform}:fixture (messageId: actual-id)`,
        status: 'legacy',
        success: true,
      });
    },
  );

  it('omits missing IDs and uses the returned destination', () => {
    const result = getSendMessagePresentation(
      { channelId: 'resolved', platform: 'discord' },
      { channelId: 'requested', platform: 'slack' },
    );

    expect(result.content).toBe('Message sent to discord:resolved');
  });
});
