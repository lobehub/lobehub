import { describe, expect, it, vi } from 'vitest';

import {
  computeAgentMailSignature,
  LobeMailApiClient,
  parseAgentMailSignature,
  verifyAgentMailSignature,
} from './api';
import { checkInboundEmail, parseRawHeaders } from './loop-guard';
import { markdownToHtml, markdownToPlainText } from './markdown';
import { stripQuotedReply } from './quotes';

describe('signature helpers', () => {
  const secret = 'whsec_abc';
  const body = '{"id":"evt_1"}';
  const now = 1_767_000_000_000;

  it('round-trips compute → verify inside the tolerance window', () => {
    const header = computeAgentMailSignature(secret, body, Math.floor(now / 1000));
    expect(verifyAgentMailSignature({ body, header, now, secret })).toBe(true);
  });

  it('rejects a body that was modified after signing', () => {
    const header = computeAgentMailSignature(secret, body, Math.floor(now / 1000));
    expect(verifyAgentMailSignature({ body: `${body} `, header, now, secret })).toBe(false);
  });

  it('rejects a signature from another secret', () => {
    const header = computeAgentMailSignature('other', body, Math.floor(now / 1000));
    expect(verifyAgentMailSignature({ body, header, now, secret })).toBe(false);
  });

  it('rejects a timestamp older than 5 minutes', () => {
    const header = computeAgentMailSignature(secret, body, Math.floor(now / 1000) - 301);
    expect(verifyAgentMailSignature({ body, header, now, secret })).toBe(false);
    const fresh = computeAgentMailSignature(secret, body, Math.floor(now / 1000) - 299);
    expect(verifyAgentMailSignature({ body, header: fresh, now, secret })).toBe(true);
  });

  it('returns null for malformed headers instead of throwing', () => {
    expect(parseAgentMailSignature(null)).toBeNull();
    expect(parseAgentMailSignature('garbage')).toBeNull();
    expect(parseAgentMailSignature('t=abc,v1=zz')).toBeNull();
    expect(verifyAgentMailSignature({ body, header: 'nope', now, secret })).toBe(false);
  });
});

describe('LobeMailApiClient', () => {
  it('surfaces the service error envelope on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: 'not_found', message: 'Inbox not found' } }, { status: 404 }),
    ) as unknown as typeof fetch;

    const client = new LobeMailApiClient({ apiKey: 'am_x', fetchImpl });
    await expect(client.getInbox('inb_missing')).rejects.toThrow(/404 — Inbox not found/);
  });

  it('creates an inbox and registers a webhook with the bearer key', async () => {
    const calls: Array<{ body?: string; url: string }> = [];
    const fetchImpl = vi.fn(async (input: any, init: any) => {
      calls.push({ body: init?.body, url: String(input) });
      if (String(input).endsWith('/v1/inboxes')) {
        return Response.json({ address: 'abc@lobe.id', id: 'inb_1' }, { status: 201 });
      }
      return Response.json({ id: 'whk_1', secret: 'whsec_1' }, { status: 201 });
    }) as unknown as typeof fetch;

    const client = new LobeMailApiClient({
      apiKey: 'am_x',
      baseUrl: 'https://api.lobe.id',
      fetchImpl,
    });
    const inbox = await client.createInbox({ clientId: 'agt_1', endUserId: 'user:u1' });
    const hook = await client.createWebhook({
      inboxId: inbox.id,
      url: 'https://app.example.com/api/agent/webhooks/email/inb_1',
    });

    expect(inbox.id).toBe('inb_1');
    expect(hook.secret).toBe('whsec_1');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ clientId: 'agt_1', endUserId: 'user:u1' });
    expect(calls[1]!.url).toBe('https://api.lobe.id/v1/webhooks');
  });

  it('long-polls the wait endpoint with the from / timeout filters', async () => {
    let seen = '';
    const fetchImpl = vi.fn(async (input: any) => {
      seen = String(input);
      return Response.json({ message: { codes: ['839201'] }, timedOut: false });
    }) as unknown as typeof fetch;

    const client = new LobeMailApiClient({
      apiKey: 'am_x',
      baseUrl: 'https://api.lobe.id',
      fetchImpl,
    });
    const result = await client.waitForMessage('inb_1', { from: 'github', timeout: 30 });

    expect(seen).toContain('/v1/inboxes/inb_1/messages/wait');
    expect(seen).toContain('from=github');
    expect(seen).toContain('timeout=30');
    expect(result.timedOut).toBe(false);
  });

  it('normalizes a slash-heavy base URL without a regex backtrack', async () => {
    let seen = '';
    const fetchImpl = vi.fn(async (input: any) => {
      seen = String(input);
      return Response.json({ address: 'abc@lobe.id', id: 'inb_1' });
    }) as unknown as typeof fetch;

    const client = new LobeMailApiClient({
      apiKey: 'am_x',
      baseUrl: `https://api.lobe.id${'/'.repeat(50_000)}`,
      fetchImpl,
    });

    // Every trailing slash is dropped, exactly once, and the request still runs.
    expect(client.baseUrl).toBe('https://api.lobe.id');
    await client.getInbox('inb_1');
    expect(seen).toBe('https://api.lobe.id/v1/inboxes/inb_1');
  });
});

describe('markdown rendering', () => {
  it('renders headings, lists, code and inline emphasis', () => {
    const html = markdownToHtml(
      '# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n```\nraw <tag>\n```',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    // Code fences are escaped, never injected as markup.
    expect(html).toContain('<pre><code>raw &lt;tag&gt;</code></pre>');
  });

  it('escapes raw HTML in the body', () => {
    expect(markdownToHtml('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('produces a readable plain-text alternative', () => {
    const text = markdownToPlainText('# Title\n\nSee [docs](https://lobehub.com)\n\n1. first');
    expect(text).toContain('Title');
    expect(text).toContain('See docs (https://lobehub.com)');
    expect(text).toContain('- first');
  });

  it('renders ordered lists as <ol>', () => {
    expect(markdownToHtml('1. a\n2. b')).toContain('<ol><li>a</li><li>b</li></ol>');
  });
});

describe('quoted reply stripping', () => {
  it('cuts an English "On ... wrote:" block', () => {
    const body =
      'Yes, that works.\n\nOn Mon, Sep 29, 2026 at 10:00 Jane <jane@x.com> wrote:\n> quote';
    expect(stripQuotedReply(body)).toBe('Yes, that works.');
  });

  it('removes Outlook header blocks and signature separators', () => {
    const body = 'Confirmed.\n\n-- \nArvin\n\nFrom: Jane\nSent: Monday\nTo: Arvin\nSubject: hi';
    expect(stripQuotedReply(body)).toBe('Confirmed.');
  });

  it('keeps the original body for a quote-only reply', () => {
    const body = 'On Mon, Sep 29, 2026 at 10:00 Jane <jane@x.com> wrote:\n> only history here';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('drops only `>`-quoted lines when there is no attribution line', () => {
    expect(stripQuotedReply('New answer\n> old\n>> older')).toBe('New answer');
  });

  it('collapses blank runs and trailing whitespace without a regex backtrack', () => {
    expect(stripQuotedReply('line one   \n\n\n\n\nline two\t\n')).toBe('line one\n\nline two');
  });

  it('handles a hostile body without pathological backtracking', () => {
    const repeats = 100_000;
    // Shapes that made the previous forms backtrack polynomially:
    //  - a line repeating an attribution keyword, with no closing `:` for the
    //    unbounded `[^\n]*?` wildcards to settle on;
    //  - a long run of tabs *not* followed by a newline, for `[ \t]+\n`;
    //  - a long run of newlines, for `\n{3,}`.
    const hostile = [
      `Am ${'schrieb '.repeat(repeats)}`,
      '在 '.repeat(repeats),
      `${'\t'.repeat(repeats)}x`,
      '\n'.repeat(repeats),
    ].join('\n');

    const started = performance.now();
    const result = stripQuotedReply(hostile);
    const elapsed = performance.now() - started;

    expect(typeof result).toBe('string');
    // Linear work finishes in milliseconds; the quadratic forms took seconds
    // on input an order of magnitude smaller.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('loop protection', () => {
  it('parses folded headers and lower-cases keys', () => {
    const headers = parseRawHeaders('From: a@b.com\r\nSubject: one\r\n two\r\nX-Y: z\r\n\r\nbody');
    expect(headers.from).toBe('a@b.com');
    expect(headers.subject).toBe('one two');
    expect(headers['x-y']).toBe('z');
  });

  const base = { from: 'someone@example.com', subject: 'Hello' };

  it('ignores auto-submitted / bulk / list mail from headers', () => {
    expect(checkInboundEmail({ ...base, headers: { 'auto-submitted': 'auto-generated' } })).toEqual(
      {
        ignored: true,
        reason: 'auto_submitted',
      },
    );
    expect(checkInboundEmail({ ...base, headers: { precedence: 'Bulk' } }).reason).toBe(
      'precedence_bulk',
    );
    expect(checkInboundEmail({ ...base, headers: { 'list-id': '<x.lists>' } }).reason).toBe(
      'mailing_list',
    );
    expect(
      checkInboundEmail({ ...base, headers: { 'x-auto-response-suppress': 'All' } }).reason,
    ).toBe('auto_response_suppress');
  });

  it('accepts an explicit Auto-Submitted: no', () => {
    expect(checkInboundEmail({ ...base, headers: { 'auto-submitted': 'no' } }).ignored).toBe(false);
  });

  it('treats a null envelope sender as a bounce', () => {
    expect(checkInboundEmail({ ...base, headers: { 'return-path': '<>' } }).reason).toBe('bounce');
  });

  it('still works when the raw headers could not be fetched', () => {
    expect(checkInboundEmail({ ...base, headers: null }).ignored).toBe(false);
    expect(
      checkInboundEmail({ ...base, headers: null, subject: 'Out of office: automatic reply' })
        .reason,
    ).toBe('auto_reply');
  });

  it('ignores mail addressed from the inbox itself', () => {
    expect(
      checkInboundEmail({ from: 'bot@lobe.id', inboxAddress: 'bot@lobe.id', subject: 'x' }).reason,
    ).toBe('self_addressed');
  });
});
