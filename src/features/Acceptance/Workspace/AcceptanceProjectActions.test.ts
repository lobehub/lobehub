import { describe, expect, it } from 'vitest';

import { getAcceptanceProjectActionTypes } from './AcceptanceProjectActions';

describe('getAcceptanceProjectActionTypes', () => {
  it('includes create and view actions for a project group', () => {
    expect(getAcceptanceProjectActionTypes('project-1')).toEqual([
      'viewProject',
      'divider',
      'createProject',
    ]);
  });

  it('only includes create for an ungrouped context', () => {
    expect(getAcceptanceProjectActionTypes()).toEqual(['createProject']);
  });
});
