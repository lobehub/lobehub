import { describe, expect, it } from 'vitest';

import { initialImportFilter } from './types';

describe('initialImportFilter', () => {
  it('imports open and completed issues by default, but not canceled ones', () => {
    expect(initialImportFilter().stateTypes).toEqual([
      'triage',
      'backlog',
      'unstarted',
      'started',
      'completed',
    ]);
  });

  it('returns a fresh state list each time, so edits do not leak into the next dialog', () => {
    const first = initialImportFilter();
    first.stateTypes.pop();

    expect(initialImportFilter().stateTypes).toContain('completed');
  });
});
