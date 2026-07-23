import { describe, expect, it } from 'vitest';

import { toGmailMessagesXml } from './formatter';
import type { GmailMessage } from './types';

const message = (
  id: string,
  sender: string,
  labels: string[] = ['CATEGORY_UPDATES'],
): GmailMessage => ({
  bodyPreview: `Body ${id}`,
  id,
  labels,
  sender,
  subject: `Subject ${id}`,
});

describe('toGmailMessagesXml', () => {
  it('escapes XML values and reports the selected message count', () => {
    const xml = toGmailMessagesXml([
      {
        bodyPreview: 'Body <unsafe> & useful',
        date: '2026-07-12T00:00:00.000Z',
        id: 'id<&',
        labels: ['R&D'],
        recipient: 'neko@example.com',
        sender: 'team@example.com',
        snippet: 'One & two',
        sourceUrl: 'gmail:thread:thread<&',
        subject: 'R&D <status>',
      },
    ]);

    expect(xml).toContain('<gmailMessages count="1">');
    expect(xml).toContain('id="id&#x3C;&#x26;"');
    expect(xml).toContain('<subject>R&#x26;D &#x3C;status></subject>');
    expect(xml).toContain('<bodyPreview>Body &#x3C;unsafe> &#x26; useful</bodyPreview>');
  });

  it('honors a hard length limit without producing invalid XML', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      ...message(`long-${index}`, `sender-${index}@example.test`),
      bodyPreview: '<&'.repeat(1000),
    }));
    const xml = toGmailMessagesXml(messages, { maxLength: 1200 });

    expect(xml.length).toBeLessThanOrEqual(1200);
    expect(xml).toMatch(/^<gmailMessages count="\d+">/);
    expect(xml).toMatch(/<\/gmailMessages>$/);
    const count = Number(xml.match(/count="(\d+)"/)?.[1]);
    expect(xml.match(/<message /g) ?? []).toHaveLength(count);
  });

  it('returns a valid empty root when no message can fit', () => {
    expect(toGmailMessagesXml([message('one', 'one@example.com')], { maxLength: 41 })).toBe(
      '<gmailMessages count="0"></gmailMessages>',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'uses the default hard ceiling for non-finite maxLength %s',
    (maxLength) => {
      const smallXml = toGmailMessagesXml([message('small', 'small@example.com')], { maxLength });
      const largeXml = toGmailMessagesXml(
        [
          {
            ...message('large', 'large@example.com'),
            bodyPreview: '<&'.repeat(100_000),
          },
        ],
        { maxLength },
      );

      expect(smallXml).toContain('<gmailMessages count="1">');
      expect(largeXml.length).toBeLessThanOrEqual(48_000);
      expect(largeXml).toContain('<gmailMessages count="1">');
    },
  );

  it('rejects a finite limit smaller than the minimum valid empty root', () => {
    expect(() => toGmailMessagesXml([], { maxLength: 40 })).toThrow(
      new RangeError('Gmail XML maxLength must be at least 41'),
    );
  });

  it('clips adversarial public message fields before XML serialization', () => {
    const xml = toGmailMessagesXml([
      {
        bodyPreview: `${'b'.repeat(1_000_000)}BODY_OVERFLOW`,
        date: `${'d'.repeat(1_000_000)}DATE_OVERFLOW`,
        id: `${'i'.repeat(1_000_000)}ID_OVERFLOW`,
        labels: [
          `${'l'.repeat(1_000_000)}LABEL_OVERFLOW`,
          ...Array.from({ length: 100 }, (_, index) => `EXTRA_LABEL_${index}`),
        ],
        recipient: `${'r'.repeat(1_000_000)}RECIPIENT_OVERFLOW`,
        sender: `${'s'.repeat(1_000_000)}SENDER_OVERFLOW`,
        snippet: `${'n'.repeat(1_000_000)}SNIPPET_OVERFLOW`,
        sourceUrl: `${'u'.repeat(1_000_000)}URL_OVERFLOW`,
        subject: `${'t'.repeat(1_000_000)}SUBJECT_OVERFLOW`,
      },
    ]);

    expect(xml.length).toBeLessThanOrEqual(48_000);
    expect(xml).not.toMatch(
      /BODY_OVERFLOW|DATE_OVERFLOW|ID_OVERFLOW|LABEL_OVERFLOW|RECIPIENT_OVERFLOW|SENDER_OVERFLOW|SNIPPET_OVERFLOW|URL_OVERFLOW|SUBJECT_OVERFLOW|EXTRA_LABEL_20/,
    );
  });

  it('reads at most 32 public messages before formatting', () => {
    let accessedBeyondBound = false;
    const messages = Array.from({ length: 32 }, (_, index) =>
      message(`bounded-${index}`, `sender-${index}@example.test`),
    );
    messages.length = 1_000_000;
    const proxiedMessages = new Proxy(messages, {
      get: (target, property, receiver) => {
        if (property === '32') {
          accessedBeyondBound = true;
          throw new Error('message beyond formatter bound accessed');
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const xml = toGmailMessagesXml(proxiedMessages);

    expect(xml).toContain('<gmailMessages count="32">');
    expect(accessedBeyondBound).toBe(false);
  });
});
