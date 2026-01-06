import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_BLOCK_LIST,
  filterFilesByBuiltInBlockList,
  filterFilesByGitignore,
  findGitignoreFile,
  parseGitignore,
  readGitignoreContent,
  shouldIgnoreFile,
} from './gitignore';

describe('gitignore utilities', () => {
  describe('BUILT_IN_BLOCK_LIST', () => {
    it('should contain common system files and folders', () => {
      expect(BUILT_IN_BLOCK_LIST).toContain('.git/');
      expect(BUILT_IN_BLOCK_LIST).toContain('node_modules/');
      expect(BUILT_IN_BLOCK_LIST).toContain('.DS_Store');
      expect(BUILT_IN_BLOCK_LIST).toContain('Thumbs.db');
    });
  });

  describe('parseGitignore', () => {
    it('should parse gitignore content and remove comments', () => {
      const content = `
# This is a comment
*.log
node_modules/
# Another comment

.env
`;
      const patterns = parseGitignore(content);
      expect(patterns).toEqual(['*.log', 'node_modules/', '.env']);
    });

    it('should remove empty lines', () => {
      const content = `
*.log


.env
`;
      const patterns = parseGitignore(content);
      expect(patterns).toEqual(['*.log', '.env']);
    });
  });

  describe('shouldIgnoreFile', () => {
    it('should match simple patterns', () => {
      expect(shouldIgnoreFile('test.log', ['*.log'])).toBe(true);
      expect(shouldIgnoreFile('test.txt', ['*.log'])).toBe(false);
    });

    it('should match directory patterns', () => {
      expect(shouldIgnoreFile('node_modules/package/index.js', ['node_modules/'])).toBe(true);
      expect(shouldIgnoreFile('src/node_modules/package/index.js', ['node_modules/'])).toBe(true);
    });

    it('should match specific files', () => {
      expect(shouldIgnoreFile('.DS_Store', ['.DS_Store'])).toBe(true);
      expect(shouldIgnoreFile('folder/.DS_Store', ['.DS_Store'])).toBe(true);
    });

    it('should handle negation patterns', () => {
      const patterns = ['*.log', '!important.log'];
      expect(shouldIgnoreFile('test.log', patterns)).toBe(true);
      expect(shouldIgnoreFile('important.log', patterns)).toBe(false);
    });
  });

  describe('findGitignoreFile', () => {
    it('should find .gitignore file in the file list', () => {
      const files = [
        new File(['content'], 'test.txt'),
        new File(['ignore rules'], '.gitignore'),
        new File(['code'], 'index.ts'),
      ];

      const gitignoreFile = findGitignoreFile(files);
      expect(gitignoreFile).toBeDefined();
      expect(gitignoreFile?.name).toBe('.gitignore');
    });

    it('should find .gitignore file with webkitRelativePath', () => {
      const file1 = new File(['content'], 'test.txt');
      const file2 = new File(['ignore rules'], '.gitignore');
      const file3 = new File(['code'], 'index.ts');

      // Simulate webkitRelativePath
      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/test.txt',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/.gitignore',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/index.ts',
        writable: false,
      });

      const files = [file1, file2, file3];
      const gitignoreFile = findGitignoreFile(files);
      expect(gitignoreFile).toBeDefined();
      expect(gitignoreFile?.name).toBe('.gitignore');
    });

    it('should return undefined when no .gitignore file exists', () => {
      const files = [new File(['content'], 'test.txt'), new File(['code'], 'index.ts')];

      const gitignoreFile = findGitignoreFile(files);
      expect(gitignoreFile).toBeUndefined();
    });
  });

  describe('readGitignoreContent', () => {
    it('should read file content as text', async () => {
      const content = '*.log\nnode_modules/';
      const file = new File([content], '.gitignore');

      const result = await readGitignoreContent(file);
      expect(result).toBe(content);
    });
  });

  describe('filterFilesByBuiltInBlockList', () => {
    it('should filter out .git folder', () => {
      const file1 = new File(['content'], 'test.txt');
      const file2 = new File(['git data'], 'HEAD');
      const file3 = new File(['code'], 'index.ts');

      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/test.txt',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/.git/HEAD',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/index.ts',
        writable: false,
      });

      const files = [file1, file2, file3];
      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.name)).toEqual(['test.txt', 'index.ts']);
    });

    it('should filter out node_modules folder', () => {
      const file1 = new File(['content'], 'test.txt');
      const file2 = new File(['package'], 'index.js');
      const file3 = new File(['code'], 'app.ts');

      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/test.txt',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/node_modules/package/index.js',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/app.ts',
        writable: false,
      });

      const files = [file1, file2, file3];
      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.name)).toEqual(['test.txt', 'app.ts']);
    });

    it('should filter out .DS_Store files', () => {
      const file1 = new File(['content'], 'test.txt');
      const file2 = new File(['metadata'], '.DS_Store');
      const file3 = new File(['code'], 'index.ts');

      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/test.txt',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/.DS_Store',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/index.ts',
        writable: false,
      });

      const files = [file1, file2, file3];
      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.name)).toEqual(['test.txt', 'index.ts']);
    });

    it('should filter out __pycache__ folder and .pyc files', () => {
      const file1 = new File(['content'], 'app.py');
      const file2 = new File(['cache'], 'module.cpython-39.pyc');
      const file3 = new File(['bytecode'], 'script.pyc');
      const file4 = new File(['code'], 'main.py');

      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/app.py',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/__pycache__/module.cpython-39.pyc',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/script.pyc',
        writable: false,
      });
      Object.defineProperty(file4, 'webkitRelativePath', {
        value: 'project/main.py',
        writable: false,
      });

      const files = [file1, file2, file3, file4];
      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.name)).toEqual(['app.py', 'main.py']);
    });

    it('should filter out IDE configuration folders', () => {
      const file1 = new File(['content'], 'test.txt');
      const file2 = new File(['idea config'], 'workspace.xml');
      const file3 = new File(['vscode config'], 'settings.json');
      const file4 = new File(['code'], 'index.ts');

      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/test.txt',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/.idea/workspace.xml',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/.vscode/settings.json',
        writable: false,
      });
      Object.defineProperty(file4, 'webkitRelativePath', {
        value: 'project/index.ts',
        writable: false,
      });

      const files = [file1, file2, file3, file4];
      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.name)).toEqual(['test.txt', 'index.ts']);
    });

    it('should not filter normal files', () => {
      const file1 = new File(['content'], 'test.txt');
      const file2 = new File(['code'], 'index.ts');
      const file3 = new File(['readme'], 'README.md');

      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/test.txt',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/index.ts',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/README.md',
        writable: false,
      });

      const files = [file1, file2, file3];
      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(3);
    });
  });

  describe('filterFilesByGitignore', () => {
    it('should filter files based on gitignore patterns', () => {
      const file1 = new File(['content'], 'test.txt');
      const file2 = new File(['logs'], 'error.log');
      const file3 = new File(['code'], 'index.ts');

      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/test.txt',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/error.log',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/index.ts',
        writable: false,
      });

      const files = [file1, file2, file3];
      const gitignoreContent = '*.log\n.env';
      const filtered = filterFilesByGitignore(files, gitignoreContent);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.name)).toEqual(['test.txt', 'index.ts']);
    });

    it('should handle nested folder patterns', () => {
      const file1 = new File(['content'], 'app.ts');
      const file2 = new File(['build'], 'bundle.js');
      const file3 = new File(['code'], 'index.ts');

      Object.defineProperty(file1, 'webkitRelativePath', {
        value: 'project/src/app.ts',
        writable: false,
      });
      Object.defineProperty(file2, 'webkitRelativePath', {
        value: 'project/dist/bundle.js',
        writable: false,
      });
      Object.defineProperty(file3, 'webkitRelativePath', {
        value: 'project/src/index.ts',
        writable: false,
      });

      const files = [file1, file2, file3];
      const gitignoreContent = 'dist/';
      const filtered = filterFilesByGitignore(files, gitignoreContent);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f) => f.name)).toEqual(['app.ts', 'index.ts']);
    });
  });
});
