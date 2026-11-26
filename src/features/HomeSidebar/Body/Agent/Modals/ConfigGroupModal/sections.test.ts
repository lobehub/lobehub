import { describe, expect, it } from 'vitest';

import { resolveConfigGroupList } from './sections';

const group = (id: string, name: string, sort = 0) => ({ id, items: [], name, sort });

const groups = [group('pub-1', 'Team Folder', 1)];
const privateGroups = [group('priv-1', 'My Folder', 2)];

describe('resolveConfigGroupList', () => {
  it('manages the personal folders with the default visibility', () => {
    expect(resolveConfigGroupList({ groups, isWorkspace: false, privateGroups })).toEqual({
      items: [{ id: 'pub-1', name: 'Team Folder', sort: 1 }],
    });
  });

  // Regression: with "Manage private categories" gone, the one dialog must
  // still manage the member's private folders in a workspace.
  it('manages only the private folders in a workspace and creates private ones', () => {
    expect(resolveConfigGroupList({ groups, isWorkspace: true, privateGroups })).toEqual({
      createVisibility: 'private',
      items: [{ id: 'priv-1', name: 'My Folder', sort: 2 }],
    });
  });
});
