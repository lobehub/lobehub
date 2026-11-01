// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DISCORD_EMBED_DEFAULT_COLOR,
  DISCORD_EMBED_LIMITS,
  normalizeDiscordEmbed,
  normalizeDiscordEmbeds,
  parseDiscordEmbedColor,
} from './embeds';

describe('parseDiscordEmbedColor', () => {
  it('accepts integers within the 24-bit range', () => {
    expect(parseDiscordEmbedColor(0x58_65_f2)).toBe(0x58_65_f2);
    expect(parseDiscordEmbedColor(0)).toBe(0);
    expect(parseDiscordEmbedColor(0x1_00_00_00)).toBeUndefined();
    expect(parseDiscordEmbedColor(-1)).toBeUndefined();
    expect(parseDiscordEmbedColor(Number.NaN)).toBeUndefined();
  });

  it('accepts hex strings with or without prefix', () => {
    expect(parseDiscordEmbedColor('#22c55e')).toBe(0x22_c5_5e);
    expect(parseDiscordEmbedColor('22C55E')).toBe(0x22_c5_5e);
    expect(parseDiscordEmbedColor('0xef4444')).toBe(0xef_44_44);
    expect(parseDiscordEmbedColor(' #f59e0b ')).toBe(0xf5_9e_0b);
  });

  it('accepts decimal numeric strings', () => {
    expect(parseDiscordEmbedColor('5793266')).toBe(5_793_266);
  });

  it('rejects unknown formats', () => {
    expect(parseDiscordEmbedColor('red')).toBeUndefined();
    expect(parseDiscordEmbedColor('#fff')).toBeUndefined();
    expect(parseDiscordEmbedColor(null)).toBeUndefined();
    expect(parseDiscordEmbedColor({})).toBeUndefined();
  });
});

describe('normalizeDiscordEmbed', () => {
  it('converts a full report card into a Discord embed', () => {
    const embed = normalizeDiscordEmbed({
      author: { icon_url: 'https://x/icon.png', name: 'Landing GA', url: 'https://x' },
      color: '#5865F2',
      description: 'Example property: `example-property` | 2026-08-10',
      fields: [
        { inline: true, name: '📅 Yesterday', value: 'Users: **100**' },
        { inline: true, name: '📅 Last 7d', value: 'Users: **700**' },
        { name: '🔥 Trending Up', value: '1. +10 PV' },
      ],
      footer: { text: 'GA4 → Discord via Apps Script' },
      thumbnail: { url: 'https://x/thumb.png' },
      timestamp: '2026-08-10T08:00:00Z',
      title: '📊 Google Analytics Daily Report',
      url: 'https://analytics.google.com',
    });

    expect(embed).toEqual({
      author: { icon_url: 'https://x/icon.png', name: 'Landing GA', url: 'https://x' },
      color: 0x58_65_f2,
      description: 'Example property: `example-property` | 2026-08-10',
      fields: [
        { inline: true, name: '📅 Yesterday', value: 'Users: **100**' },
        { inline: true, name: '📅 Last 7d', value: 'Users: **700**' },
        { name: '🔥 Trending Up', value: '1. +10 PV' },
      ],
      footer: { text: 'GA4 → Discord via Apps Script' },
      thumbnail: { url: 'https://x/thumb.png' },
      timestamp: '2026-08-10T08:00:00.000Z',
      title: '📊 Google Analytics Daily Report',
      url: 'https://analytics.google.com',
    });
  });

  it('applies the default colour when none is given or it is invalid', () => {
    expect(normalizeDiscordEmbed({ title: 'a' })?.color).toBe(DISCORD_EMBED_DEFAULT_COLOR);
    expect(normalizeDiscordEmbed({ color: 'purple', title: 'a' })?.color).toBe(
      DISCORD_EMBED_DEFAULT_COLOR,
    );
  });

  it('accepts loose aliases the model is likely to produce', () => {
    const embed = normalizeDiscordEmbed({
      author: 'Reporter',
      colour: '#22c55e',
      fields: [{ label: 'Users', value: 42 }],
      footer: 'generated',
      imageUrl: 'https://x/img.png',
      text: 'body',
      thumbnailUrl: 'https://x/t.png',
      timestamp: true,
    });

    expect(embed).toMatchObject({
      author: { name: 'Reporter' },
      color: 0x22_c5_5e,
      description: 'body',
      fields: [{ name: 'Users', value: '42' }],
      footer: { text: 'generated' },
      image: { url: 'https://x/img.png' },
      thumbnail: { url: 'https://x/t.png' },
    });
    expect(typeof embed?.timestamp).toBe('string');
  });

  it('truncates strings to Discord limits and caps fields at 25', () => {
    const embed = normalizeDiscordEmbed({
      description: 'd'.repeat(5000),
      fields: Array.from({ length: 30 }, (_, i) => ({
        name: `n${i}`.repeat(200),
        value: 'v'.repeat(2000),
      })),
      footer: { text: 'f'.repeat(3000) },
      title: 't'.repeat(300),
    });

    expect(embed?.title).toHaveLength(DISCORD_EMBED_LIMITS.title);
    expect(embed?.title?.endsWith('…')).toBe(true);
    expect(embed?.description).toHaveLength(DISCORD_EMBED_LIMITS.description);
    expect(embed?.footer?.text).toHaveLength(DISCORD_EMBED_LIMITS.footerText);
    expect(embed?.fields).toHaveLength(DISCORD_EMBED_LIMITS.fields);
    expect(embed?.fields?.[0].name).toHaveLength(DISCORD_EMBED_LIMITS.fieldName);
    expect(embed?.fields?.[0].value).toHaveLength(DISCORD_EMBED_LIMITS.fieldValue);
  });

  it('drops non-http urls and unknown keys', () => {
    const embed = normalizeDiscordEmbed({
      footer: { icon_url: 'javascript:alert(1)', text: 'ok' },
      image: { url: 'data:image/png;base64,xxx' },
      title: 'a',
      unknown: 'x',
      url: 'ftp://nope',
    });

    expect(embed).toEqual({
      color: DISCORD_EMBED_DEFAULT_COLOR,
      footer: { text: 'ok' },
      title: 'a',
    });
  });

  it('fills a missing field name or value with a zero-width placeholder', () => {
    const embed = normalizeDiscordEmbed({
      fields: [{ name: 'only name' }, { value: 'only value' }, { inline: true }],
      title: 'a',
    });

    expect(embed?.fields).toEqual([
      { name: 'only name', value: '​' },
      { name: '​', value: 'only value' },
    ]);
  });

  it('returns undefined when nothing visible remains', () => {
    expect(normalizeDiscordEmbed({ color: '#fff000', url: 'https://x' })).toBeUndefined();
    expect(normalizeDiscordEmbed({ title: '   ' })).toBeUndefined();
    expect(normalizeDiscordEmbed('not an object')).toBeUndefined();
    expect(normalizeDiscordEmbed(null)).toBeUndefined();
  });
});

describe('normalizeDiscordEmbeds', () => {
  it('returns undefined for empty or non-array input', () => {
    expect(normalizeDiscordEmbeds(undefined)).toBeUndefined();
    expect(normalizeDiscordEmbeds([])).toBeUndefined();
    expect(normalizeDiscordEmbeds('nope')).toBeUndefined();
    expect(normalizeDiscordEmbeds([{ color: 1 }, null])).toBeUndefined();
  });

  it('skips invalid entries and caps the list at 10 embeds', () => {
    const embeds = normalizeDiscordEmbeds([
      null,
      ...Array.from({ length: 12 }, (_, i) => ({ title: `e${i}` })),
    ]);

    expect(embeds).toHaveLength(DISCORD_EMBED_LIMITS.perMessage);
    expect(embeds?.[0].title).toBe('e0');
  });

  it('shrinks a later embed into the remaining 6000 character message budget', () => {
    const embeds = normalizeDiscordEmbeds([
      { description: 'a'.repeat(4000) },
      { description: 'b'.repeat(2500) },
      { description: 'c'.repeat(1500) },
    ]);

    expect(embeds).toHaveLength(2);
    expect(embeds?.[0].description).toHaveLength(4000);
    // second embed is cut down to the 2000 characters left in the budget
    expect(embeds?.[1].description).toHaveLength(2000);
    expect(embeds?.[1].description?.startsWith('b')).toBe(true);
  });

  it('shrinks an oversized single embed by dropping trailing fields, then the description', () => {
    const embeds = normalizeDiscordEmbeds([
      {
        description: 'd'.repeat(5000),
        fields: Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, value: 'v'.repeat(2000) })),
        footer: { text: 'footer' },
        title: 'Report',
      },
    ]);

    const embed = embeds?.[0];
    expect(embed?.title).toBe('Report');
    expect(embed?.footer?.text).toBe('footer');
    // description is capped to 4096 first; with title + footer that leaves
    // room for one 1024-char field (2 + 1024) but not two.
    expect(embed?.fields).toHaveLength(1);
    expect(embed?.description).toHaveLength(DISCORD_EMBED_LIMITS.description);
    const total =
      (embed?.title?.length ?? 0) +
      (embed?.description?.length ?? 0) +
      (embed?.footer?.text.length ?? 0) +
      (embed?.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.totalCharacters);
  });

  it('drops an embed whose fixed parts alone exceed the remaining budget', () => {
    const embeds = normalizeDiscordEmbeds([
      { description: 'a'.repeat(4096), footer: { text: 'f'.repeat(1900) } },
      { footer: { text: 'g'.repeat(100) }, title: 't'.repeat(200) },
    ]);

    expect(embeds).toHaveLength(1);
  });
});
