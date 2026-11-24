import { describe, expect, it } from 'vitest';

import { resolveConfigGroupSections } from './sections';

const group = (id: string, name: string, sort = 0) => ({ id, items: [], name, sort });

const groups = [group('pub-1', 'Team Folder', 1)];
const privateGroups = [group('priv-1', 'My Folder', 2)];

describe('resolveConfigGroupSections', () => {
  it('manages the personal folders with the default visibility', () => {
    expect(resolveConfigGroupSections({ groups, isWorkspace: false, privateGroups })).toEqual({
      ownGroups: [{ id: 'pub-1', name: 'Team Folder', sort: 1 }],
      workspaceGroups: [],
    });
  });

  // Regression: dropping "Manage private categories" must not strand private
  // folders, nor the folders already published to the workspace.
  it('puts private folders first and keeps published folders in a workspace', () => {
    expect(resolveConfigGroupSections({ groups, isWorkspace: true, privateGroups })).toEqual({
      createVisibility: 'private',
      ownGroups: [{ id: 'priv-1', name: 'My Folder', sort: 2 }],
      workspaceGroups: [{ id: 'pub-1', name: 'Team Folder', sort: 1 }],
    });
  });
});
