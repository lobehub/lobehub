// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { filterGroupsByMemberScope } from '../../message/groupNodes';

const groups = [{ id: 'in-scope' }, { id: 'out-of-scope' }, { id: 'no-members' }];

describe('filterGroupsByMemberScope', () => {
  it('ignores rows that carry no message group id', () => {
    // The select left-joins plugins, so a row can come back without a group id;
    // such a row must not create a phantom member entry.
    expect(filterGroupsByMemberScope(groups, [{ inScope: null, messageGroupId: null }])).toEqual(
      groups,
    );
  });

  it('drops a group whose members are all outside the read scope', () => {
    expect(
      filterGroupsByMemberScope(groups, [{ inScope: false, messageGroupId: 'out-of-scope' }]),
    ).toEqual([{ id: 'in-scope' }, { id: 'no-members' }]);
  });

  it('keeps a group as soon as one member is in scope', () => {
    expect(
      filterGroupsByMemberScope(groups, [
        { inScope: false, messageGroupId: 'out-of-scope' },
        { inScope: true, messageGroupId: 'out-of-scope' },
        { inScope: true, messageGroupId: 'in-scope' },
      ]),
    ).toEqual(groups);
  });

  it('keeps a group with no members at all', () => {
    expect(filterGroupsByMemberScope(groups, [])).toEqual(groups);
  });
});
