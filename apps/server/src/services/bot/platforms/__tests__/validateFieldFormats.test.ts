import { describe, expect, it } from 'vitest';

import { schema as discordSchema } from '../discord/schema';
import { schema as telegramSchema } from '../telegram/schema';
import type { FieldSchema } from '../types';
import { collectFieldFormatViolations, formatFieldFormatViolations } from '../validateFieldFormats';

/**
 * Every value here only imitates the SHAPE of a Discord credential; the bytes
 * are invented, and each one is worded so it cannot be mistaken for a real
 * secret. Never paste an actual credential into this file.
 */
const VALID_DISCORD = {
  applicationId: '1000000000000000001',
  credentials: {
    botToken: 'ExampleDiscordBotToken00.Fake01.NotARealSecretValue000000',
    publicKey: '4f1c8a2d9b30e7654c1de8ab72f09356d4ea18bc27309fd6a5b4c8e0173fa29d',
  },
};

const fieldsOf = (violations: Array<{ field: string }>) => violations.map((v) => v.field);

describe('collectFieldFormatViolations', () => {
  it('accepts well-formed Discord credentials', () => {
    expect(collectFieldFormatViolations(discordSchema, VALID_DISCORD)).toEqual([]);
  });

  // The three shapes below are the ones that actually get pasted into the
  // Public Key box by mistake; the values themselves are invented.
  it.each([
    [
      'an OAuth authorize URL',
      'https://discord.com/oauth2/authorize?client_id=1000000000000000001',
    ],
    ['a block of prose', '## Summary - Endpoint or schema scope, consumers, version'],
    ['a LobeHub API key', 'sk-lh-000000000000fake'],
  ])('rejects %s pasted into publicKey', (_label, publicKey) => {
    const violations = collectFieldFormatViolations(discordSchema, {
      ...VALID_DISCORD,
      credentials: { ...VALID_DISCORD.credentials, publicKey },
    });

    expect(fieldsOf(violations)).toEqual(['credentials.publicKey']);
  });

  it('rejects a public key of the wrong length or with non-hex characters', () => {
    const tooShort = 'a'.repeat(63);
    const nonHex = `${'a'.repeat(63)}z`;

    for (const publicKey of [tooShort, nonHex, 'a'.repeat(65)]) {
      const violations = collectFieldFormatViolations(discordSchema, {
        credentials: { publicKey },
      });
      expect(fieldsOf(violations)).toEqual(['credentials.publicKey']);
    }
  });

  it('rejects a bot token that is not three dot-separated segments', () => {
    const violations = collectFieldFormatViolations(discordSchema, {
      credentials: { botToken: 'sk-lh-000000000000fake' },
    });

    expect(fieldsOf(violations)).toEqual(['credentials.botToken']);
  });

  it('rejects an application ID that is not a snowflake', () => {
    const violations = collectFieldFormatViolations(discordSchema, {
      applicationId: 'https://discord.com/oauth2/authorize?client_id=1000000000000000001',
    });

    expect(fieldsOf(violations)).toEqual(['applicationId']);
  });

  it('reports every offending field at once so the caller can fix them in one pass', () => {
    const violations = collectFieldFormatViolations(discordSchema, {
      applicationId: 'my-bot',
      credentials: { botToken: 'nope', publicKey: 'nope' },
    });

    expect(fieldsOf(violations).sort()).toEqual([
      'applicationId',
      'credentials.botToken',
      'credentials.publicKey',
    ]);
  });

  it('skips sections the caller omitted, so partial updates stay valid', () => {
    expect(collectFieldFormatViolations(discordSchema, {})).toEqual([]);
    expect(
      collectFieldFormatViolations(discordSchema, { applicationId: VALID_DISCORD.applicationId }),
    ).toEqual([]);
  });

  it('treats an empty value as required-check territory, not a format error', () => {
    expect(
      collectFieldFormatViolations(discordSchema, { applicationId: '', credentials: {} }),
    ).toEqual([]);
    expect(collectFieldFormatViolations(discordSchema, { credentials: { publicKey: '' } })).toEqual(
      [],
    );
  });

  it('leaves platforms without declared patterns untouched', () => {
    expect(
      collectFieldFormatViolations(telegramSchema, {
        applicationId: 'anything',
        credentials: { botToken: 'anything at all' },
      }),
    ).toEqual([]);
  });

  it('returns nothing when the platform has no schema', () => {
    expect(collectFieldFormatViolations(undefined, VALID_DISCORD)).toEqual([]);
  });

  it('walks nested credential groups', () => {
    const nested: FieldSchema[] = [
      {
        key: 'credentials',
        label: 'credentials',
        properties: [
          {
            key: 'group',
            label: 'group',
            properties: [
              { key: 'code', label: 'code', pattern: String.raw`^\d{4}$`, type: 'string' },
            ],
            type: 'object',
          },
        ],
        type: 'object',
      },
    ];

    const violations = collectFieldFormatViolations(nested, {
      credentials: { group: { code: 'abcd' } } as unknown as Record<string, string>,
    });

    expect(fieldsOf(violations)).toEqual(['credentials.group.code']);
  });
});

describe('formatFieldFormatViolations', () => {
  it('names each field alongside the pattern it failed', () => {
    const violations = collectFieldFormatViolations(discordSchema, {
      credentials: { publicKey: 'nope' },
    });

    expect(formatFieldFormatViolations(violations)).toBe(
      String.raw`"credentials.publicKey" (expected /^[\dA-Fa-f]{64}$/)`,
    );
  });
});
