import { describe, expect, it } from 'vitest';

import { getLanguageDisplayLabel } from './getLanguageDisplayLabel';

describe('getLanguageDisplayLabel', () => {
  it('shows the resolved locale alongside Follow System in auto mode', () => {
    expect(getLanguageDisplayLabel('auto', 'en-US', 'Follow System')).toBe(
      'Follow System · English',
    );
  });

  it('shows the manually selected locale without the auto-mode label', () => {
    expect(getLanguageDisplayLabel('fr-FR', 'en-US', 'Follow System')).toBe('Français');
  });
});
