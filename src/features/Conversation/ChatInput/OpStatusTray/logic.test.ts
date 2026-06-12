import { describe, expect, it } from 'vitest';

import { parseStatusPhrases, pickStableStatusPhrase } from './logic';

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
  });
});
