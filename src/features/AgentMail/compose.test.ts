import { afterEach, describe, expect, it } from 'vitest';

import {
  backupKeyOf,
  forwardSubject,
  hasSeparator,
  initialFieldsFor,
  invalidAddresses,
  isValidAddress,
  parseAddressList,
  quoteForForward,
  quoteForReply,
  rememberSendRefusal,
  replyRecipients,
  replySourceOf,
  replySubject,
  sendBlockOf,
  sendFailureOf,
} from './compose';

const mail = (extra: Record<string, unknown> = {}) =>
  ({
    accountId: 'acc_a',
    attachments: [],
    cc: [],
    deliveredAt: new Date('2026-11-10T08:00:00Z'),
    direction: 'inbound',
    fromAddress: 'lin@partner.example',
    fromName: '林悦',
    id: 'm1',
    replyTo: [],
    subject: 'Q3 plan',
    text: 'line one\n\nline two',
    to: [{ address: 'scout@lobe.id' }],
    ...extra,
  }) as never;

const account = (extra: Record<string, unknown> = {}) =>
  ({
    capabilities: { receive: true, send: true },
    id: 'acc_a',
    status: 'active',
    ...extra,
  }) as never;

afterEach(() => localStorage.clear());

describe('addresses', () => {
  it('parses names, brackets and lists', () => {
    expect(parseAddressList('Lin <lin@a.com>, b@b.com;\n"Zhou R" <z@c.io>')).toEqual([
      { address: 'lin@a.com', name: 'Lin' },
      { address: 'b@b.com' },
      { address: 'z@c.io', name: 'Zhou R' },
    ]);
  });

  it('keeps a quoted name with a comma as one recipient', () => {
    expect(parseAddressList('"Doe, John" <j@x.com>, b@b.com')).toEqual([
      { address: 'j@x.com', name: 'Doe, John' },
      { address: 'b@b.com' },
    ]);
  });

  it('sees separators only outside quoted names', () => {
    expect(hasSeparator('"Doe, John"')).toBe(false);
    expect(hasSeparator('"Doe, John" <j@x.com>')).toBe(false);
    expect(hasSeparator('"Doe, John" <j@x.com>,')).toBe(true);
    expect(hasSeparator('a@b.com;')).toBe(true);
  });

  it('marks what is plainly not an address', () => {
    expect(isValidAddress('a@b.co')).toBe(true);
    expect(isValidAddress('a@b')).toBe(false);
    expect(isValidAddress('not an address')).toBe(false);
    expect(
      invalidAddresses({
        bcc: [{ address: 'x@' }],
        cc: [{ address: 'ok@c.com' }],
        to: [{ address: 'a.b.com' }],
      }),
    ).toEqual(['a.b.com', 'x@']);
  });
});

describe('subjects', () => {
  it('prefixes once', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
    expect(replySubject(null)).toBe('Re: ');
    expect(forwardSubject('Hello')).toBe('Fwd: Hello');
    expect(forwardSubject('Fw: Hello')).toBe('Fw: Hello');
  });
});

describe('replies', () => {
  it('answers the newest received mail, never a sent one', () => {
    const inbound = mail({ id: 'in' });
    const outbound = mail({ direction: 'outbound', id: 'out' });
    expect(replySourceOf([inbound, outbound])).toBe(inbound);
    expect(replySourceOf([outbound])).toBeUndefined();
  });

  it('goes to Reply-To first, then the sender', () => {
    expect(replyRecipients(mail(), 'scout@lobe.id', false)).toEqual({
      cc: [],
      to: [{ address: 'lin@partner.example', name: '林悦' }],
    });
    expect(
      replyRecipients(mail({ replyTo: [{ address: 'desk@partner.example' }] }), 'x', false).to,
    ).toEqual([{ address: 'desk@partner.example' }]);
  });

  it('reply-all copies everyone else, never this address or a duplicate', () => {
    const source = mail({
      cc: [{ address: 'ops@team.example' }, { address: 'LIN@partner.example' }],
      to: [{ address: 'Scout@lobe.id' }, { address: 'zhou@team.example' }],
    });
    expect(replyRecipients(source, 'scout@lobe.id', true).cc).toEqual([
      { address: 'zhou@team.example' },
      { address: 'ops@team.example' },
    ]);
  });

  it('quotes the original below the answer', () => {
    expect(quoteForReply(mail(), 'On …, Lin wrote:')).toBe(
      '\n\nOn …, Lin wrote:\n> line one\n>\n> line two',
    );
  });

  it('starts a reply with recipients, subject and quote filled in', () => {
    const fields = initialFieldsFor(
      'replyAll',
      mail({ cc: [{ address: 'c@d.com' }] }),
      'scout@lobe.id',
      'H',
    );
    expect(fields.subject).toBe('Re: Q3 plan');
    expect(fields.cc).toEqual([{ address: 'c@d.com' }]);
    expect(fields.text.startsWith('\n\nH\n> line one')).toBe(true);
  });
});

describe('originals without plain text', () => {
  it('adds no quote the server would add again', () => {
    expect(quoteForForward(mail({ text: '' }))).toBe('');
    expect(quoteForReply(mail({ text: '  ' }), 'H')).toBe('');
  });
});

describe('forwards', () => {
  it('carries the original verbatim, so the server does not add it twice', () => {
    const quote = quoteForForward(mail());
    expect(quote).toContain('---------- Forwarded message ---------');
    expect(quote).toContain('From: 林悦 <lin@partner.example>');
    expect(quote).toContain('line one\n\nline two');
    const fields = initialFieldsFor('forward', mail(), 'scout@lobe.id', 'H');
    expect(fields).toMatchObject({ subject: 'Fwd: Q3 plan', to: [] });
  });
});

describe('send blocks', () => {
  it('reads what the address itself says', () => {
    expect(sendBlockOf(account())).toBeUndefined();
    expect(sendBlockOf(account({ capabilities: { receive: true, send: false } }))).toBe(
      'receive_only',
    );
    expect(sendBlockOf(account({ status: 'suspended' }))).toBe('suspended');
    expect(sendBlockOf(account({ status: 'revoked' }))).toBe('released');
    expect(sendBlockOf(undefined)).toBe('released');
  });

  it('remembers a receive-only refusal for a day and a used-up quota until midnight', () => {
    const now = new Date('2026-11-11T10:00:00').getTime();
    rememberSendRefusal('acc_a', 'send_disabled', now);
    expect(sendBlockOf(account(), now + 60_000)).toBe('receive_only');
    expect(sendBlockOf(account(), now + 25 * 60 * 60 * 1000)).toBeUndefined();

    rememberSendRefusal('acc_a', 'send_limit_daily', now);
    expect(sendBlockOf(account(), now)).toBe('limit_reached');
    expect(sendBlockOf(account(), new Date('2026-11-12T00:00:01').getTime())).toBeUndefined();

    rememberSendRefusal('acc_a', 'send_failed', now);
    expect(sendBlockOf(account(), now)).toBeUndefined();
  });
});

describe('send failures', () => {
  const failure = (code?: string, message = 'boom') =>
    Object.assign(new Error(message), { data: { errorData: code ? { code } : undefined } });

  it('maps the server codes to what the person can do', () => {
    expect(sendFailureOf(failure('send_disabled'))).toMatchObject({
      key: 'identity.compose.block.receiveOnly',
      retryable: false,
    });
    expect(sendFailureOf(failure('send_limit_hourly')).key).toBe(
      'identity.compose.error.limitHourly',
    );
    expect(sendFailureOf(failure('reply_target_gone')).key).toBe(
      'identity.compose.error.targetGone',
    );
    expect(sendFailureOf(failure('send_rejected', 'mailbox unavailable'))).toMatchObject({
      key: 'identity.compose.error.rejected',
      reason: 'mailbox unavailable',
    });
  });

  it('treats anything unknown, or a network error, as nothing sent and retryable', () => {
    expect(sendFailureOf(new TypeError('Failed to fetch'))).toEqual({
      code: undefined,
      key: 'identity.compose.error.failed',
      retryable: true,
    });
  });
});

describe('backup keys', () => {
  it('keys by agent, address and draft, or the mail answered, or new', () => {
    expect(backupKeyOf('agt', 'acc', { draftId: 'd1' })).toBe('lobe-agent-mail:draft:agt:acc:d1');
    expect(backupKeyOf('agt', 'acc', { mode: 'reply', sourceMailId: 'm1' })).toBe(
      'lobe-agent-mail:draft:agt:acc:reply:m1',
    );
    expect(backupKeyOf('agt', 'acc', { mode: 'compose' })).toBe(
      'lobe-agent-mail:draft:agt:acc:new',
    );
  });
});
