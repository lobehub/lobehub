import { describe, expect, it } from 'vitest';

import { buildFolderTree, topologicalSortFolders } from './folderStructure';

describe('folder uploads with object property names', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    '%s is a folder name',
    (name) => {
      const direct = new File(['direct'], 'direct.txt');
      const nested = new File(['nested'], 'nested.txt');
      Object.defineProperty(direct, 'webkitRelativePath', { value: `${name}/direct.txt` });
      Object.defineProperty(nested, 'webkitRelativePath', { value: `${name}/child/nested.txt` });

      const tree = buildFolderTree([direct, nested]);

      expect(tree.folders[name]).toEqual({ name, parent: null });
      expect(tree.folders[`${name}/child`]).toEqual({ name: 'child', parent: name });
      expect(tree.filesByFolder[name]).toEqual([direct]);
      expect(tree.filesByFolder[`${name}/child`]).toEqual([nested]);
      expect(topologicalSortFolders(tree.folders)).toEqual([name, `${name}/child`]);
      expect(Object.hasOwn(tree.folders, name)).toBe(true);
    },
  );
});
