import { describe, expect, it } from 'vitest';

import { buildMemberFilterOptions } from './memberFilterOptions';

const members = [{ userId: 'neko' }, { userId: 'bot' }, { userId: 'lin' }, { userId: 'jiyuan' }];
const toOption = (member: { userId: string }) => ({ value: member.userId });

describe('buildMemberFilterOptions', () => {
  it('puts the viewer first, outside the workspace member group', () => {
    expect(buildMemberFilterOptions(members, 'lin', 'Workspace members', toOption)).toEqual([
      { value: 'lin' },
      { group: 'Workspace members', value: 'neko' },
      { group: 'Workspace members', value: 'bot' },
      { group: 'Workspace members', value: 'jiyuan' },
    ]);
  });

  it('follows whoever is signed in', () => {
    expect(buildMemberFilterOptions(members, 'jiyuan', 'Workspace members', toOption)[0]).toEqual({
      value: 'jiyuan',
    });
  });

  it('keeps directory order under the group when the viewer is not a member', () => {
    expect(
      buildMemberFilterOptions(members, 'someone-else', 'G', toOption).map((o) => o.value),
    ).toEqual(['neko', 'bot', 'lin', 'jiyuan']);
  });
});
