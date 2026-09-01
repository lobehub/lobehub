import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it } from 'vitest';

import { buildAgentShareUrl, normalizeAgentShareSlug, validateAgentShareSlug } from './shareLink';

describe('normalizeAgentShareSlug', () => {
  it('trims and lowercases', () => {
    expect(normalizeAgentShareSlug('  My-Bot  ')).toBe('my-bot');
  });
});

describe('validateAgentShareSlug', () => {
  it('accepts a well-formed slug', () => {
    expect(validateAgentShareSlug('my-cool-bot')).toBeNull();
    expect(validateAgentShareSlug('abc')).toBeNull();
    expect(validateAgentShareSlug('a1b')).toBeNull();
  });

  it('rejects slugs shorter than 3 or longer than 64 characters', () => {
    expect(validateAgentShareSlug('ab')).toBe('tooShort');
    expect(validateAgentShareSlug('a'.repeat(65))).toBe('tooLong');
    expect(validateAgentShareSlug('a'.repeat(64))).toBeNull();
  });

  it('rejects uppercase, underscores, spaces and edge hyphens', () => {
    expect(validateAgentShareSlug('My-Bot')).toBe('invalid');
    expect(validateAgentShareSlug('my_bot')).toBe('invalid');
    expect(validateAgentShareSlug('my bot')).toBe('invalid');
    expect(validateAgentShareSlug('-mybot')).toBe('invalid');
    expect(validateAgentShareSlug('mybot-')).toBe('invalid');
  });

  it('rejects UUID-shaped slugs, which would never resolve as a slug', () => {
    expect(validateAgentShareSlug('123e4567-e89b-12d3-a456-426614174000')).toBe('invalid');
  });

  it('rejects reserved words', () => {
    expect(validateAgentShareSlug('settings')).toBe('reserved');
    expect(validateAgentShareSlug('share')).toBe('reserved');
  });

  // Shares live at `/agent/<slug>`, where the creator's own agents always win
  // the lookup, so a share on a builtin slug would be unreachable forever.
  it('rejects every builtin agent slug', () => {
    for (const slug of Object.values(BUILTIN_AGENT_SLUGS)) {
      expect([slug, validateAgentShareSlug(slug)]).toEqual([slug, 'reserved']);
    }
  });
});

describe('buildAgentShareUrl', () => {
  const origin = 'https://app.lobehub.com';

  it('prefers the custom slug', () => {
    expect(buildAgentShareUrl({ origin, shareId: 'share-id', slug: 'my-bot' })).toBe(
      'https://app.lobehub.com/agent/my-bot',
    );
  });

  it('falls back to the share id', () => {
    expect(buildAgentShareUrl({ origin, shareId: 'share-id' })).toBe(
      'https://app.lobehub.com/agent/share-id',
    );
    expect(buildAgentShareUrl({ origin, shareId: 'share-id', slug: '' })).toBe(
      'https://app.lobehub.com/agent/share-id',
    );
  });
});
