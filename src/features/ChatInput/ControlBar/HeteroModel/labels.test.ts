import { describe, expect, it } from 'vitest';

import { getModelLabel } from './labels';

describe('getModelLabel', () => {
  it('shows the model half of a persisted provider/model tuple', () => {
    expect(getModelLabel('["deepseek-official","deepseek-v4-flash"]', 'Default')).toBe(
      'deepseek-v4-flash',
    );
    expect(getModelLabel('["gateway","deepseek-v4-pro"]', 'Default')).toBe('deepseek-v4-pro');
  });

  it('keeps plain ids and the default sentinel unchanged', () => {
    expect(getModelLabel('default', 'Default')).toBe('Default');
    expect(getModelLabel('some-plain-model', 'Default')).toBe('some-plain-model');
    expect(getModelLabel('gpt-5.5', 'Default')).toBe('GPT-5.5');
    expect(getModelLabel('claude-opus-4-1', 'Default')).toBe('Opus 4.1');
  });

  it('falls back to the raw value when the tuple is malformed', () => {
    expect(getModelLabel('["only-one-element"]', 'Default')).toBe('["only-one-element"]');
    expect(getModelLabel('[not json', 'Default')).toBe('[not json');
  });
});
