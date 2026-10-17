import { describe, expect, it } from 'vitest';

import { validateEnvironmentName } from './environmentName';

describe('environment name validation', () => {
  it.each(['', ' \t\n '])('rejects an empty trimmed name', (name) => {
    expect(validateEnvironmentName(name)).toBe('required');
  });

  it.each(['测', '中文 🧪 !', 'a'.repeat(255), `  ${'a'.repeat(255)}  `])(
    'accepts a valid trimmed name',
    (name) => {
      expect(validateEnvironmentName(name)).toBeUndefined();
    },
  );

  it.each([256, 1024])('explains an overlong %i-character name', (length) => {
    expect(validateEnvironmentName('x'.repeat(length))).toBe('tooLong');
  });

  it('allows correcting an overlong draft without truncating it', () => {
    const draft = 'x'.repeat(1024);
    expect(validateEnvironmentName(draft)).toBe('tooLong');
    expect(draft).toHaveLength(1024);
    expect(validateEnvironmentName('corrected name')).toBeUndefined();
  });

  it('matches the server UTF-16 length for emoji at the boundary', () => {
    expect(validateEnvironmentName(`${'x'.repeat(253)}🧪`)).toBeUndefined();
    expect(validateEnvironmentName(`${'x'.repeat(254)}🧪`)).toBe('tooLong');
  });
});
