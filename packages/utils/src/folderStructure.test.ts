import { describe, expect, it } from 'vitest';

import { buildFolderTree, sanitizeFolderName, topologicalSortFolders } from './folderStructure';

describe('folderStructure', () => {
  describe('buildFolderTree', () => {
    it('should handle single files without folders', () => {
      const files = [new File(['content1'], 'file1.txt'), new File(['content2'], 'file2.txt')];

      const result = buildFolderTree(files);

      expect(result.folders).toEqual({});
      expect(result.filesByFolder['']).toHaveLength(2);
      expect(result.filesByFolder[''][0].name).toBe('file1.txt');
      expect(result.filesByFolder[''][1].name).toBe('file2.txt');
    });

    it('should build folder structure from files with webkitRelativePath', () => {
      const file1 = new File(['content'], 'file.txt');
      (file1 as any).webkitRelativePath = 'folder1/file.txt';

      const file2 = new File(['content'], 'file2.txt');
      (file2 as any).webkitRelativePath = 'folder1/file2.txt';

      const result = buildFolderTree([file1, file2]);

      expect(result.folders).toEqual({
        folder1: {
          name: 'folder1',
          parent: null,
        },
      });

      expect(result.filesByFolder['folder1']).toHaveLength(2);
      expect(result.filesByFolder['folder1'][0].name).toBe('file.txt');
      expect(result.filesByFolder['folder1'][1].name).toBe('file2.txt');
    });

    it('should handle nested folder structures', () => {
      const file1 = new File(['content'], 'deep.txt');
      (file1 as any).webkitRelativePath = 'folder1/subfolder1/subfolder2/deep.txt';

      const result = buildFolderTree([file1]);

      expect(result.folders).toEqual({
        'folder1': {
          name: 'folder1',
          parent: null,
        },
        'folder1/subfolder1': {
          name: 'subfolder1',
          parent: 'folder1',
        },
        'folder1/subfolder1/subfolder2': {
          name: 'subfolder2',
          parent: 'folder1/subfolder1',
        },
      });

      expect(result.filesByFolder['folder1/subfolder1/subfolder2']).toHaveLength(1);
      expect(result.filesByFolder['folder1/subfolder1/subfolder2'][0].name).toBe('deep.txt');
    });

    it('should handle multiple files in different folders', () => {
      const file1 = new File(['content1'], 'file1.txt');
      (file1 as any).webkitRelativePath = 'folder1/file1.txt';

      const file2 = new File(['content2'], 'file2.txt');
      (file2 as any).webkitRelativePath = 'folder2/file2.txt';

      const file3 = new File(['content3'], 'file3.txt');
      (file3 as any).webkitRelativePath = 'folder1/subfolder/file3.txt';

      const result = buildFolderTree([file1, file2, file3]);

      expect(result.folders).toEqual({
        'folder1': {
          name: 'folder1',
          parent: null,
        },
        'folder2': {
          name: 'folder2',
          parent: null,
        },
        'folder1/subfolder': {
          name: 'subfolder',
          parent: 'folder1',
        },
      });

      expect(result.filesByFolder['folder1']).toHaveLength(1);
      expect(result.filesByFolder['folder2']).toHaveLength(1);
      expect(result.filesByFolder['folder1/subfolder']).toHaveLength(1);
    });

    it('should not duplicate folders when processing multiple files in same folder', () => {
      const file1 = new File(['content1'], 'file1.txt');
      (file1 as any).webkitRelativePath = 'shared/file1.txt';

      const file2 = new File(['content2'], 'file2.txt');
      (file2 as any).webkitRelativePath = 'shared/file2.txt';

      const file3 = new File(['content3'], 'file3.txt');
      (file3 as any).webkitRelativePath = 'shared/file3.txt';

      const result = buildFolderTree([file1, file2, file3]);

      // Should only have one 'shared' folder entry
      expect(Object.keys(result.folders)).toEqual(['shared']);
      expect(result.folders['shared']).toEqual({
        name: 'shared',
        parent: null,
      });

      // All three files should be in the same folder
      expect(result.filesByFolder['shared']).toHaveLength(3);
    });

    it('should handle mixed single files and folder files', () => {
      const file1 = new File(['content1'], 'root.txt');

      const file2 = new File(['content2'], 'nested.txt');
      (file2 as any).webkitRelativePath = 'folder/nested.txt';

      const result = buildFolderTree([file1, file2]);

      expect(result.folders).toEqual({
        folder: {
          name: 'folder',
          parent: null,
        },
      });

      expect(result.filesByFolder['']).toHaveLength(1);
      expect(result.filesByFolder[''][0].name).toBe('root.txt');
      expect(result.filesByFolder['folder']).toHaveLength(1);
      expect(result.filesByFolder['folder'][0].name).toBe('nested.txt');
    });

    it('should handle empty file array', () => {
      const result = buildFolderTree([]);

      expect(result.folders).toEqual({});
      expect(result.filesByFolder).toEqual({});
    });

    it('should handle files with special characters in path', () => {
      const file = new File(['content'], 'file.txt');
      (file as any).webkitRelativePath = 'my-folder/sub_folder/file.txt';

      const result = buildFolderTree([file]);

      expect(result.folders).toEqual({
        'my-folder': {
          name: 'my-folder',
          parent: null,
        },
        'my-folder/sub_folder': {
          name: 'sub_folder',
          parent: 'my-folder',
        },
      });
    });
  });

  describe('topologicalSortFolders', () => {
    it('should sort folders by depth (shallowest first)', () => {
      const folders = {
        'a/b/c': { name: 'c', parent: 'a/b' },
        'a': { name: 'a', parent: null },
        'a/b': { name: 'b', parent: 'a' },
      };

      const result = topologicalSortFolders(folders);

      expect(result).toEqual(['a', 'a/b', 'a/b/c']);
    });

    it('should sort multiple root-level folders correctly', () => {
      const folders = {
        'folder2/sub': { name: 'sub', parent: 'folder2' },
        'folder1': { name: 'folder1', parent: null },
        'folder2': { name: 'folder2', parent: null },
      };

      const result = topologicalSortFolders(folders);

      // Root folders should come before nested folders
      expect(result[0]).toBe('folder1');
      expect(result[1]).toBe('folder2');
      expect(result[2]).toBe('folder2/sub');
    });

    it('should handle complex nested structures', () => {
      const folders = {
        'a/b/c/d': { name: 'd', parent: 'a/b/c' },
        'x/y': { name: 'y', parent: 'x' },
        'a': { name: 'a', parent: null },
        'x': { name: 'x', parent: null },
        'a/b': { name: 'b', parent: 'a' },
        'a/b/c': { name: 'c', parent: 'a/b' },
      };

      const result = topologicalSortFolders(folders);

      // Check that parents always come before children
      expect(result.indexOf('a')).toBeLessThan(result.indexOf('a/b'));
      expect(result.indexOf('a/b')).toBeLessThan(result.indexOf('a/b/c'));
      expect(result.indexOf('a/b/c')).toBeLessThan(result.indexOf('a/b/c/d'));
      expect(result.indexOf('x')).toBeLessThan(result.indexOf('x/y'));
    });

    it('should handle single folder', () => {
      const folders = {
        folder: { name: 'folder', parent: null },
      };

      const result = topologicalSortFolders(folders);

      expect(result).toEqual(['folder']);
    });

    it('should handle empty folder object', () => {
      const result = topologicalSortFolders({});

      expect(result).toEqual([]);
    });

    it('should preserve order for folders at same depth', () => {
      const folders = {
        'a/b': { name: 'b', parent: 'a' },
        'a/c': { name: 'c', parent: 'a' },
        'a/d': { name: 'd', parent: 'a' },
        'a': { name: 'a', parent: null },
      };

      const result = topologicalSortFolders(folders);

      // Parent should be first
      expect(result[0]).toBe('a');

      // Siblings (same depth) should maintain their relative order
      const siblings = result.slice(1);
      expect(siblings).toHaveLength(3);
      expect(siblings).toContain('a/b');
      expect(siblings).toContain('a/c');
      expect(siblings).toContain('a/d');
    });
  });

  describe('sanitizeFolderName', () => {
    it('should keep valid alphanumeric characters', () => {
      expect(sanitizeFolderName('MyFolder123')).toBe('MyFolder123');
    });

    it('should keep spaces', () => {
      expect(sanitizeFolderName('My Folder Name')).toBe('My Folder Name');
    });

    it('should keep hyphens and underscores', () => {
      expect(sanitizeFolderName('my-folder_name')).toBe('my-folder_name');
    });

    it('should replace invalid characters with underscores', () => {
      expect(sanitizeFolderName('folder/name')).toBe('folder_name');
      expect(sanitizeFolderName('folder\\name')).toBe('folder_name');
      expect(sanitizeFolderName('folder:name')).toBe('folder_name');
      expect(sanitizeFolderName('folder*name')).toBe('folder_name');
      expect(sanitizeFolderName('folder?name')).toBe('folder_name');
      expect(sanitizeFolderName('folder"name')).toBe('folder_name');
      expect(sanitizeFolderName('folder<name>')).toBe('folder_name_');
      expect(sanitizeFolderName('folder|name')).toBe('folder_name');
    });

    it('should replace control characters with underscores', () => {
      expect(sanitizeFolderName('folder\x00name')).toBe('folder_name');
      expect(sanitizeFolderName('folder\x01name')).toBe('folder_name');
      expect(sanitizeFolderName('folder\x1Fname')).toBe('folder_name');
    });

    it('should trim whitespace from start and end', () => {
      expect(sanitizeFolderName('  folder  ')).toBe('folder');
      expect(sanitizeFolderName('\tfolder\t')).toBe('_folder_');
    });

    it('should handle multiple invalid characters', () => {
      expect(sanitizeFolderName('my/folder\\with:many*invalid?chars')).toBe(
        'my_folder_with_many_invalid_chars',
      );
    });

    it('should handle empty string', () => {
      expect(sanitizeFolderName('')).toBe('');
    });

    it('should handle string with only invalid characters', () => {
      expect(sanitizeFolderName('/:*?<>|')).toBe('_______');
    });

    it('should handle unicode characters correctly', () => {
      expect(sanitizeFolderName('我的文件夹')).toBe('我的文件夹');
      expect(sanitizeFolderName('папка')).toBe('папка');
      expect(sanitizeFolderName('フォルダ')).toBe('フォルダ');
    });

    it('should handle mixed valid and invalid characters', () => {
      expect(sanitizeFolderName('Project-2024_draft/final?')).toBe('Project-2024_draft_final_');
    });
  });
});
