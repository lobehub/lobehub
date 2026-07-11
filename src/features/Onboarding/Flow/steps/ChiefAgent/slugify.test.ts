import { describe, expect, it } from 'vitest';

import { slugifyAgentName } from './slugify';

describe('slugifyAgentName', () => {
  it('lowercases a simple name', () => {
    expect(slugifyAgentName('Potato')).toBe('potato');
  });

  it('collapses whitespace and punctuation into single hyphens', () => {
    expect(slugifyAgentName('  Cool  Bot!! ')).toBe('cool-bot');
  });

  it('strips diacritics', () => {
    expect(slugifyAgentName('Café Bot')).toBe('cafe-bot');
  });

  it('falls back to a default slug when nothing alphanumeric remains', () => {
    expect(slugifyAgentName('')).toBe('agent');
    expect(slugifyAgentName('！！！')).toBe('agent');
  });
});
