import { describe, expect, it } from 'vitest';

import type { LibraryMenuEntry } from './libraryMenuItems';
import { buildLibraryMenuItems } from './libraryMenuItems';

const labels = { private: 'Private', workspace: 'Workspace' };

const entry = (key: string, visibility?: LibraryMenuEntry['visibility']): LibraryMenuEntry => ({
  item: { key, label: key },
  visibility,
});

describe('buildLibraryMenuItems', () => {
  it('groups private libraries before workspace libraries in workspace mode', () => {
    const privateA = entry('private-a', 'private');
    const workspaceA = entry('workspace-a', 'public');
    const privateB = entry('private-b', 'private');
    const workspaceB = entry('workspace-b');

    expect(
      buildLibraryMenuItems([workspaceA, privateA, workspaceB, privateB], true, labels),
    ).toEqual([
      {
        children: [privateA.item, privateB.item],
        key: 'library-group-private',
        label: 'Private',
        type: 'group',
      },
      {
        children: [workspaceA.item, workspaceB.item],
        key: 'library-group-workspace',
        label: 'Workspace',
        type: 'group',
      },
    ]);
  });

  it('omits an empty workspace group when every library is private', () => {
    const privateLibrary = entry('private', 'private');

    expect(buildLibraryMenuItems([privateLibrary], true, labels)).toEqual([
      {
        children: [privateLibrary.item],
        key: 'library-group-private',
        label: 'Private',
        type: 'group',
      },
    ]);
  });

  it('keeps a flat list when workspace mode has no private libraries', () => {
    const workspaceA = entry('workspace-a', 'public');
    const workspaceB = entry('workspace-b');

    expect(buildLibraryMenuItems([workspaceA, workspaceB], true, labels)).toEqual([
      workspaceA.item,
      workspaceB.item,
    ]);
  });

  it('keeps a flat list in personal mode', () => {
    const privateLibrary = entry('private', 'private');
    const publicLibrary = entry('public', 'public');

    expect(buildLibraryMenuItems([privateLibrary, publicLibrary], false, labels)).toEqual([
      privateLibrary.item,
      publicLibrary.item,
    ]);
  });
});
