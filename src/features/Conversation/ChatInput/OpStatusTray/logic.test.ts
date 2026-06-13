import { describe, expect, it } from 'vitest';

import { parseStatusPhrases, pickRotatingStatusPhrase, pickStableStatusPhrase } from './logic';

describe('OpStatusTray logic', () => {
  describe('status phrases', () => {
    it('parses a pipe-delimited localized phrase list', () => {
      expect(parseStatusPhrases('Working | Flambéing | 努力干活中 | ')).toEqual([
        'Working',
        'Flambéing',
        '努力干活中',
      ]);
    });

    it('parses a localized phrase array', () => {
      expect(parseStatusPhrases(['Working', 'Flambéing', '', 1])).toEqual(['Working', 'Flambéing']);
    });

    it('picks a stable phrase for the same operation seed', () => {
      const phrases = ['Working', 'Thinking', 'Flambéing'];

      expect(pickStableStatusPhrase(phrases, 'op-123')).toBe(
        pickStableStatusPhrase(phrases, 'op-123'),
      );
      expect(phrases).toContain(pickStableStatusPhrase(phrases, 'op-123'));
    });

    it('starts the rotation from the stable phrase and advances by step', () => {
      const phrases = ['Working', 'Thinking', 'Flambéing'];

      const start = pickStableStatusPhrase(phrases, 'op-123');
      expect(pickRotatingStatusPhrase(phrases, 'op-123', 0)).toBe(start);

      const startIndex = phrases.indexOf(start!);
      expect(pickRotatingStatusPhrase(phrases, 'op-123', 1)).toBe(
        phrases[(startIndex + 1) % phrases.length],
      );
    });

    it('wraps around the phrase list as the step grows', () => {
      const phrases = ['Working', 'Thinking', 'Flambéing'];

      expect(pickRotatingStatusPhrase(phrases, 'op-123', 0)).toBe(
        pickRotatingStatusPhrase(phrases, 'op-123', phrases.length),
      );
    });

    it('tolerates non-finite or negative steps', () => {
      const phrases = ['Working', 'Thinking', 'Flambéing'];

      expect(pickRotatingStatusPhrase(phrases, 'op-123', Number.NaN)).toBe(
        pickRotatingStatusPhrase(phrases, 'op-123', 0),
      );
      expect(pickRotatingStatusPhrase(phrases, 'op-123', -5)).toBe(
        pickRotatingStatusPhrase(phrases, 'op-123', 0),
      );
    });

    it('returns undefined when there are no phrases', () => {
      expect(pickRotatingStatusPhrase([], 'op-123', 3)).toBeUndefined();
    });
  });
});
