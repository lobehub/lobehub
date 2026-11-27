import { describe, expect, it } from 'vitest';

import { resolveDetailTab } from './detailTabs';

describe('resolveDetailTab', () => {
  it('opens the tab the link names', () => {
    expect(resolveDetailTab('files', false)).toBe('files');
    expect(resolveDetailTab('terminal', true)).toBe('terminal');
  });

  it('falls back to the overview for a missing or unknown tab', () => {
    expect(resolveDetailTab(null, true)).toBe('overview');
    expect(resolveDetailTab('shell', true)).toBe('overview');
  });

  it('keeps the terminal from a caller who may not operate the device', () => {
    expect(resolveDetailTab('terminal', false)).toBe('overview');
  });
});
