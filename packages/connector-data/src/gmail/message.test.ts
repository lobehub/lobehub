import { describe, expect, it, vi } from 'vitest';

import { parseGmailMessages } from './message';

const message = (id: string, sender = 'sender@example.com') => ({
  id,
  labelIds: ['CATEGORY_UPDATES'],
  sender,
  subject: `Subject ${id}`,
});

describe('parseGmailMessages', () => {
  it('handles nullable fields and nested Composio envelopes', () => {
    expect(
      parseGmailMessages({
        result: {
          data: {
            emails: [
              {
                date: '2026-07-10T12:00:00Z',
                internalDate: null,
                labels: null,
                messageId: 'nullable',
                messageText: null,
                messageTimestamp: null,
                payload: null,
                preview: { body: 'Fallback preview' },
                sender: null,
                subject: 'Nullable',
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        bodyPreview: 'Fallback preview',
        date: '2026-07-10T12:00:00.000Z',
        id: 'nullable',
        labels: [],
        sourceUrl: 'gmail:message:nullable',
        subject: 'Nullable',
      },
    ]);
  });

  it.each([
    [{ data_preview: [message('preview-direct')] }, 'preview-direct'],
    [
      { data: { results: [{ response: { data: { messages: [message('response-data')] } } }] } },
      'response-data',
    ],
    [
      {
        data: {
          results: [{ response: { data_preview: { messages: [message('response-preview')] } } }],
        },
      },
      'response-preview',
    ],
  ])('handles Composio preview and execution response envelopes', (envelope, id) => {
    expect(parseGmailMessages(envelope)).toMatchObject([{ id }]);
  });

  it('does not enumerate unrelated top-level envelope fields', () => {
    const envelope = {
      data: [message('safe-envelope')],
      get unrelated(): never {
        throw new Error('unrelated envelope field accessed');
      },
    };

    expect(parseGmailMessages(envelope)).toMatchObject([{ id: 'safe-envelope' }]);
  });

  it('never reads a candidate beyond the configured bound', () => {
    let accessedBeyondBound = false;
    const candidates = Array.from({ length: 25 }, (_, index) => message(`bounded-${index}`));
    candidates.length = 1_000_000;
    const proxiedCandidates = new Proxy(candidates, {
      get: (target, property, receiver) => {
        if (property === '25') {
          accessedBeyondBound = true;
          throw new Error('out-of-bound candidate accessed');
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(parseGmailMessages({ data: proxiedCandidates })).toHaveLength(25);
    expect(accessedBeyondBound).toBe(false);
  });

  it('deduplicates IDs before reading an expensive duplicate payload', () => {
    const duplicate = {
      id: 'duplicate',
      get payload(): never {
        throw new Error('duplicate payload accessed');
      },
    };

    expect(parseGmailMessages({ data: [message('duplicate'), duplicate] })).toHaveLength(1);
  });

  it('clips multi-megabyte fields before normalization work', () => {
    const replaceAll = vi.spyOn(String.prototype, 'replaceAll');

    const result = parseGmailMessages({
      data: [
        {
          messageId: 'huge',
          messageText: `${'a'.repeat(3_000_000)}BODY_OVERFLOW`,
          sender: `${'s'.repeat(1_000_000)}@example.com`,
          snippet: `${'n'.repeat(1_000_000)}SNIPPET_OVERFLOW`,
          subject: `${'t'.repeat(1_000_000)}SUBJECT_OVERFLOW`,
        },
      ],
    })?.[0];
    const largestNormalizedInput = Math.max(
      ...replaceAll.mock.instances.map((value) => String(value).length),
    );
    replaceAll.mockRestore();

    expect(largestNormalizedInput).toBeLessThanOrEqual(32_000);
    expect(JSON.stringify(result)).not.toMatch(/BODY_OVERFLOW|SNIPPET_OVERFLOW|SUBJECT_OVERFLOW/);
  });

  it.each(['labelIds', 'labels'] as const)(
    'reads at most 20 entries from a million-item %s array',
    (field) => {
      let accessedBeyondBound = false;
      const labels = Array.from({ length: 20 }, (_, index) => `LABEL_${index}`);
      labels.length = 1_000_000;
      const proxiedLabels = new Proxy(labels, {
        get: (target, property, receiver) => {
          if (property === '20') {
            accessedBeyondBound = true;
            throw new Error('label beyond bound accessed');
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const result = parseGmailMessages({
        data: [{ [field]: proxiedLabels, id: `bounded-${field}`, subject: 'Bounded labels' }],
      })?.[0];

      expect(result?.labels).toHaveLength(20);
      expect(accessedBeyondBound).toBe(false);
    },
  );

  it('bounds MIME depth, child count, and total parts', () => {
    const unreachable = {
      get mimeType(): never {
        throw new Error('unreachable MIME part visited');
      },
    };
    let deepPart: Record<string, unknown> = unreachable;
    for (let depth = 0; depth < 20; depth += 1) deepPart = { parts: [deepPart] };
    const payload = {
      headers: [{ name: 'Subject', value: 'Bounded MIME' }],
      parts: [...Array.from({ length: 16 }, () => deepPart), unreachable],
    };

    expect(
      parseGmailMessages({ data: [{ id: 'bounded-mime', payload, snippet: 'usable' }] }),
    ).toEqual([
      {
        id: 'bounded-mime',
        labels: [],
        snippet: 'usable',
        sourceUrl: 'gmail:message:bounded-mime',
        subject: 'Bounded MIME',
      },
    ]);
  });

  it('does not enumerate unrelated MIME part fields', () => {
    const payload = {
      body: { data: Buffer.from('Safe MIME body').toString('base64url') },
      mimeType: 'text/plain',
      get unrelated(): never {
        throw new Error('unrelated MIME field accessed');
      },
    };

    expect(
      parseGmailMessages({ data: [{ id: 'safe-mime', payload, subject: 'Safe' }] }),
    ).toMatchObject([{ bodyPreview: 'Safe MIME body', id: 'safe-mime' }]);
  });

  it('decodes base64url text/plain before HTML and converts HTML as fallback', () => {
    const plain = Buffer.from('Plain <body> & useful').toString('base64url');
    const html = Buffer.from('<p>HTML <strong>fallback</strong> &amp; useful</p>').toString(
      'base64url',
    );

    expect(
      parseGmailMessages({
        data: [
          {
            id: 'plain',
            payload: {
              parts: [
                { body: { data: html }, mimeType: 'text/html' },
                { body: { data: plain }, mimeType: 'text/plain' },
              ],
            },
            subject: 'Plain',
          },
          {
            id: 'html',
            payload: { body: { data: html }, mimeType: 'text/html' },
            subject: 'HTML',
          },
        ],
      }),
    ).toMatchObject([
      { bodyPreview: 'Plain <body> & useful', id: 'plain' },
      { bodyPreview: 'HTML fallback & useful', id: 'html' },
    ]);
  });

  it('limits the number of inspected candidates', () => {
    expect(
      parseGmailMessages({ data: [message('first'), message('second')] }, { maxCandidates: 1 }),
    ).toMatchObject([{ id: 'first' }]);
  });

  it('rejects unsupported recursive envelope shapes', () => {
    expect(
      parseGmailMessages({ response: { items: [message('unexpected-recursive-envelope')] } }),
    ).toBeUndefined();
  });
});
