import { describe, expect, it } from 'vitest';

import { buildKVUpdateInput } from './kvUpdateInput';

describe('buildKVUpdateInput', () => {
  it('keeps the stored values of a write-only credential when no pair is entered', () => {
    const input = buildKVUpdateInput(
      7,
      { kvPairs: [{ key: '', value: '' }], name: 'Team token' },
      true,
    );

    expect(input).toEqual({ description: undefined, id: 7, name: 'Team token' });
    expect(input).not.toHaveProperty('values');
  });

  it('replaces the values of a write-only credential with the pairs entered', () => {
    const input = buildKVUpdateInput(
      7,
      {
        kvPairs: [
          { key: 'TEAM_TOKEN', value: 'new-value' },
          { key: 'EMPTY', value: '' },
        ],
        name: 'Team token',
      },
      true,
    );

    expect(input.values).toEqual({ TEAM_TOKEN: 'new-value' });
  });

  it('always sends the values of a readable credential', () => {
    expect(buildKVUpdateInput(7, { kvPairs: [], name: 'Mine' }).values).toEqual({});
  });
});
