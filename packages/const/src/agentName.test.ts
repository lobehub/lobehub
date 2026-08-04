import { describe, expect, it } from 'vitest';

import { randomAgentName } from './agentName';

const sample = (locale?: string, times = 200) =>
  Array.from({ length: times }, () => randomAgentName(locale));

describe('randomAgentName', () => {
  it('returns a Chinese name of 2–4 characters for zh locales', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'zh']) {
      for (const name of sample(locale, 50)) {
        expect(name).toMatch(/^\p{Script=Han}{2,4}$/u);
      }
    }
  });

  it('produces two, three and four character Chinese names over enough draws', () => {
    const lengths = new Set(sample('zh-CN', 500).map((name) => name.length));

    expect(lengths).toContain(2);
    expect(lengths).toContain(3);
    expect(lengths).toContain(4);
  });

  it('never composes a double given name that reads as an everyday word', () => {
    // Pair-level blocks: composeDouble rejects these pairs, so they cannot
    // appear anywhere in a name — bare, after a surname, or after a compound
    // surname — hence the substring assertion.
    // prettier-ignore
    const blockedHans = [
      '明白', '晚安', '安眠', '雪白', '青白', '风月', '风雨', '云雨', '望风', '望远',
      '清华', '昭然', '雪山', '梅雨', '朝阳', '新华', '雅安', '洛阳', '宁夏', '新竹',
      '永和', '云烟', '风烟', '竹笙', '夕阳', '祈雨', '文言', '碧玉', '牧歌', '时辰',
      '岁月', '素颜', '新颖', '明星', '风雪', '文墨', '春梦', '鹿晗',
    ];
    // prettier-ignore
    const blockedHant = [
      '明白', '晚安', '安眠', '雪白', '青白', '風月', '風雨', '雲雨', '望風', '望遠',
      '清華', '昭然', '雪山', '梅雨', '朝陽', '新華', '雅安', '洛陽', '寧夏', '新竹',
      '永和', '雲煙', '風煙', '竹笙', '夕陽', '祈雨', '文言', '碧玉', '牧歌', '時辰',
      '歲月', '素顏', '新穎', '明星', '風雪', '文墨', '春夢', '鹿晗',
    ];

    for (const name of sample('zh-CN', 2000)) {
      for (const word of blockedHans) expect(name).not.toContain(word);
    }
    for (const name of sample('zh-TW', 2000)) {
      for (const word of blockedHant) expect(name).not.toContain(word);
    }
  });

  it('never returns a full name that collides with a brand or iconic person', () => {
    // Full-name blocks are exact-match only — "马云汐" is a legitimate draw
    // even though it starts with a blocked name.
    const blockedFull = new Set(['马云', '李宁', '周瑜', '馬雲', '李寧']);

    for (const locale of ['zh-CN', 'zh-TW']) {
      for (const name of sample(locale, 3000)) {
        expect(blockedFull.has(name)).toBe(false);
      }
    }
  });

  it('uses traditional script for zh-TW and simplified for zh-CN', () => {
    const simplifiedOnly = /[诺宁欢云轩远静晓]/;
    const traditionalOnly = /[諾寧歡雲軒遠靜曉]/;

    for (const name of sample('zh-TW', 300)) {
      expect(name).not.toMatch(simplifiedOnly);
    }
    for (const name of sample('zh-CN', 300)) {
      expect(name).not.toMatch(traditionalOnly);
    }
  });

  it('returns a script-appropriate name for languages with a dedicated pool', () => {
    const expectations: [string, RegExp][] = [
      ['ar', /^\p{Script=Arabic}+$/u],
      ['fa-IR', /^\p{Script=Arabic}+$/u],
      ['ja-JP', /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u],
      ['ko-KR', /^\p{Script=Hangul}+$/u],
      ['ru-RU', /^\p{Script=Cyrillic}+$/u],
      ['bg-BG', /^\p{Script=Cyrillic}+$/u],
      ['fr-FR', /^\p{Script=Latin}+$/u],
      ['de-DE', /^\p{Script=Latin}+$/u],
      ['es-ES', /^\p{Script=Latin}+$/u],
      ['it-IT', /^\p{Script=Latin}+$/u],
      ['nl-NL', /^\p{Script=Latin}+$/u],
      ['pl-PL', /^\p{Script=Latin}+$/u],
      ['pt-BR', /^\p{Script=Latin}+$/u],
      ['tr-TR', /^\p{Script=Latin}+$/u],
      ['vi-VN', /^\p{Script=Latin}+$/u],
    ];

    for (const [locale, pattern] of expectations) {
      for (const name of sample(locale, 30)) {
        expect(name, `locale ${locale}`).toMatch(pattern);
      }
    }
  });

  it('falls back to the English pool for unknown locales', () => {
    for (const locale of ['en-US', 'sv-SE', undefined]) {
      for (const name of sample(locale, 50)) {
        expect(name).toMatch(/^[A-Z]+$/i);
      }
    }
  });

  it('draws from a pool rather than always returning the same name', () => {
    expect(new Set(sample('en-US')).size).toBeGreaterThan(1);
    expect(new Set(sample('zh-CN')).size).toBeGreaterThan(1);
    expect(new Set(sample('ja-JP')).size).toBeGreaterThan(1);
  });

  describe('exclude', () => {
    it('never returns an excluded name', () => {
      const taken = Array.from({ length: 200 }, () => randomAgentName('en-US')).slice(0, 5);

      for (let i = 0; i < 200; i++) {
        expect(taken).not.toContain(randomAgentName('en-US', taken));
      }
    });

    it('avoids excluded names for composed Chinese names', () => {
      const taken = Array.from({ length: 20 }, () => randomAgentName('zh-CN'));

      for (let i = 0; i < 200; i++) {
        expect(taken).not.toContain(randomAgentName('zh-CN', taken));
      }
    });

    it('matches excluded names case- and whitespace-insensitively', () => {
      const name = randomAgentName('en-US');

      for (let i = 0; i < 200; i++) {
        expect(randomAgentName('en-US', [`  ${name.toUpperCase()}  `])).not.toBe(name);
      }
    });

    it('falls back to the full pool when everything is excluded', () => {
      const everything = Array.from({ length: 500 }, () => randomAgentName('ko-KR'));

      expect(randomAgentName('ko-KR', everything)).toMatch(/^\p{Script=Hangul}+$/u);
    });

    it('ignores blank entries', () => {
      expect(randomAgentName('en-US', ['', '   '])).toMatch(/^[A-Z]+$/i);
    });
  });
});
