// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  attachmentDeliveryState,
  describeAttachmentFailure,
  summarizeAttachmentFailures,
  warnAttachmentFailures,
} from './attachmentDelivery';

describe('describeAttachmentFailure', () => {
  it('names the file, the type, the reason and the detail', () => {
    expect(
      describeAttachmentFailure({
        detail: 'fetch failed (Invalid IP address: undefined)',
        name: 'report.docx',
        reason: 'source-unavailable',
        type: 'file',
      }),
    ).toBe(
      '"report.docx" (file): source-unavailable — fetch failed (Invalid IP address: undefined)',
    );
  });

  it('copes with an unnamed attachment and no detail', () => {
    expect(describeAttachmentFailure({ reason: 'upload-failed', type: 'image' })).toBe(
      '"(unnamed)" (image): upload-failed',
    );
  });
});

describe('warnAttachmentFailures', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes ONE production-visible line naming every failed attachment', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    warnAttachmentFailures('bot-platform:wechat:sendMessage', [
      { detail: 'HTTP 403', name: 'a.png', reason: 'source-unavailable', type: 'image' },
      { name: 'b.pdf', reason: 'upload-failed', type: 'file' },
    ]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      `[bot-platform:wechat:sendMessage] 2 attachment(s) were not delivered — ${summarizeAttachmentFailures(
        [
          { detail: 'HTTP 403', name: 'a.png', reason: 'source-unavailable', type: 'image' },
          { name: 'b.pdf', reason: 'upload-failed', type: 'file' },
        ],
      )}`,
    );
  });

  it('stays silent when nothing failed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    warnAttachmentFailures('scope', []);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('attachmentDeliveryState', () => {
  it('adds nothing to a text-only send', () => {
    expect(attachmentDeliveryState(undefined)).toEqual({});
  });

  it('reports the count without a failures list when everything landed', () => {
    expect(attachmentDeliveryState({ delivered: 2, failures: [] })).toEqual({
      attachmentsDelivered: 2,
    });
  });

  it('carries the failures when some attachments were lost', () => {
    const failures = [{ name: 'x', reason: 'upload-failed' as const, type: 'file' as const }];

    expect(attachmentDeliveryState({ delivered: 1, failures })).toEqual({
      attachmentFailures: failures,
      attachmentsDelivered: 1,
    });
  });
});
