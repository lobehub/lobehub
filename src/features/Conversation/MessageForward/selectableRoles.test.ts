import { describe, expect, it } from 'vitest';

import { isSelectableRow } from './selectableRoles';

describe('isSelectableRow', () => {
  it('selects live user and assistant rows', () => {
    expect(isSelectableRow({ role: 'user' })).toBe(true);
    expect(isSelectableRow({ role: 'assistantGroup' })).toBe(true);
    expect(isSelectableRow({ role: 'tool' })).toBe(false);
  });

  it('never selects a compressed history row, whatever its role', () => {
    expect(isSelectableRow({ readOnlyHistory: true, role: 'user' })).toBe(false);
    expect(isSelectableRow({ readOnlyHistory: true, role: 'assistant' })).toBe(false);
  });
});
