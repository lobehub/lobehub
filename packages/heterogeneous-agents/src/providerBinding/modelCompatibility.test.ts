import { describe, expect, it } from 'vitest';

import { getKimiModelCompatibility, isKimiModelCandidate } from './modelCompatibility';

describe('Kimi custom-provider model candidates', () => {
  it('does not infer verification from tool capability', () => {
    expect(getKimiModelCompatibility({ abilities: { functionCall: true } })).toBe('untested');
    expect(isKimiModelCandidate({ abilities: { functionCall: true } })).toBe(true);
  });
  it('allows missing metadata as explicitly unknown, not verified', () => {
    expect(getKimiModelCompatibility({})).toBe('toolsUnknown');
    expect(isKimiModelCandidate({})).toBe(true);
  });
  it('rejects explicit lack of tool support', () => {
    expect(getKimiModelCompatibility({ abilities: { functionCall: false } })).toBe(
      'toolsUnsupported',
    );
    expect(isKimiModelCandidate({ abilities: { functionCall: false } })).toBe(false);
  });
});
