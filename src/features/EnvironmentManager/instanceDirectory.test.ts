import { describe, expect, it } from 'vitest';

import { suggestInstanceDirectory } from './instanceDirectory';

describe('suggestInstanceDirectory', () => {
  it('turns a name into one path segment', () => {
    expect(suggestInstanceDirectory('Lobehub Dev')).toBe('lobehub-dev');
    expect(suggestInstanceDirectory('  Q3 Reports  ')).toBe('q3-reports');
  });

  it('never suggests a nested path', () => {
    // A slash would put this instance inside another's tree, which is the one
    // thing separate instances exist to prevent.
    expect(suggestInstanceDirectory('reports/q3')).toBe('reports-q3');
    expect(suggestInstanceDirectory('../escape')).toBe('escape');
  });

  it('never suggests a hidden folder, or the reserved one', () => {
    // `.sandbox` holds the environment snapshots this instance is restored
    // from; a working directory there would run inside its own store.
    expect(suggestInstanceDirectory('.sandbox')).toBe('sandbox');
    expect(suggestInstanceDirectory('.hidden')).toBe('hidden');
  });

  it('gives back nothing when nothing usable is left', () => {
    // Blank leaves the field empty and the button disabled, which is better
    // than proposing a folder called `-`.
    expect(suggestInstanceDirectory('—— ///')).toBe('');
    expect(suggestInstanceDirectory('')).toBe('');
  });

  it('keeps a name that is already a usable folder', () => {
    expect(suggestInstanceDirectory('lobehub-dev')).toBe('lobehub-dev');
    expect(suggestInstanceDirectory('v1.2_beta')).toBe('v1.2_beta');
  });
});
