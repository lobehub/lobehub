import { describe, expect, it } from 'vitest';

import { randomAgentName } from './agentName';

const sample = (locale?: string, times = 200) =>
  Array.from({ length: times }, () => randomAgentName(locale));

describe('randomAgentName', () => {
  it('returns a two-character Chinese name for zh locales', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'zh-HK', 'zh']) {
      for (const name of sample(locale, 100)) {
        expect(name).toMatch(/^\p{Script=Han}{2}$/u);
      }
    }
  });

  it('mixes "小X", reduplicated and composed Chinese names', () => {
    const names = sample('zh-CN', 1000);

    expect(names.some((name) => name.startsWith('小'))).toBe(true);
    expect(names.some((name) => name[0] === name[1])).toBe(true);
    expect(names.some((name) => !name.startsWith('小') && name[0] !== name[1])).toBe(true);
  });

  it('draws Chinese names from a space wide enough to rarely repeat', () => {
    // A flat pool of ~100 names repeated within a few dozen agents; the
    // composed shape is what keeps a long sidebar varied.
    expect(new Set(sample('zh-CN', 2000)).size).toBeGreaterThan(1000);
    expect(new Set(sample('zh-TW', 2000)).size).toBeGreaterThan(1000);
  });

  it('never returns an assistant brand, an everyday word or a place name', () => {
    // prettier-ignore
    const blocked = new Set([
      '小爱', '小度', '小艺', '小冰', '小布', '小娜', '小微', '小蜜', '小米', '小智',
      '小心', '小时', '小说', '小姐', '小三', '小学', '小人', '小吃',
      '明白', '晚安', '可乐', '语言', '明星', '南宁', '洛阳', '慕容', '荷兰', '乐意',
      '小愛', '小藝', '小說', '小時', '小學', '語言', '南寧', '洛陽', '荷蘭', '樂意',
    ]);

    for (const locale of ['zh-CN', 'zh-TW']) {
      for (const name of sample(locale, 5000)) {
        expect(blocked.has(name), name).toBe(false);
      }
    }
  });

  it('uses traditional script for zh-TW and simplified for zh-CN', () => {
    const simplifiedOnly = /[诺宁乐云满远树圆鸥书诗语听鹤栀兰阳晓锦忆仪桥静颖莹]/;
    const traditionalOnly = /[諾寧樂雲滿遠樹圓鷗書詩語聽鶴梔蘭陽曉錦憶儀橋靜穎瑩]/;

    for (const name of sample('zh-TW', 3000)) {
      expect(name).not.toMatch(simplifiedOnly);
    }
    for (const name of sample('zh-CN', 3000)) {
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

    it('avoids excluded names for Chinese names', () => {
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
