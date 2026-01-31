import { beforeEach, describe, expect, it } from 'vitest';

import {
  BUILT_IN_BLOCK_LIST,
  filterFilesByBuiltInBlockList,
  filterFilesByGitignore,
  findGitignoreFile,
  parseGitignore,
  readGitignoreContent,
  shouldIgnoreFile,
} from '../gitignore';

describe('gitignore.ts', () => {
  describe('BUILT_IN_BLOCK_LIST', () => {
    it('should contain standard patterns', () => {
      expect(BUILT_IN_BLOCK_LIST).toContain('.git/');
      expect(BUILT_IN_BLOCK_LIST).toContain('node_modules/');
      expect(BUILT_IN_BLOCK_LIST).toContain('.DS_Store');
      expect(BUILT_IN_BLOCK_LIST).toContain('__pycache__/');
    });

    it('should be a readonly array', () => {
      expect(Array.isArray(BUILT_IN_BLOCK_LIST)).toBe(true);
      expect(BUILT_IN_BLOCK_LIST.length).toBeGreaterThan(0);
    });
  });

  describe('parseGitignore', () => {
    it('should parse simple patterns', () => {
      const content = 'node_modules/\n*.log\ndist/';
      const patterns = parseGitignore(content);

      expect(patterns).toEqual(['node_modules/', '*.log', 'dist/']);
    });

    it('should remove comments', () => {
      const content = '# This is a comment\nnode_modules/\n# Another comment\n*.log';
      const patterns = parseGitignore(content);

      expect(patterns).toEqual(['node_modules/', '*.log']);
      expect(patterns).not.toContain('# This is a comment');
    });

    it('should remove empty lines', () => {
      const content = 'node_modules/\n\n\n*.log\n\n';
      const patterns = parseGitignore(content);

      expect(patterns).toEqual(['node_modules/', '*.log']);
      expect(patterns.length).toBe(2);
    });

    it('should trim whitespace from lines', () => {
      const content = '  node_modules/  \n  *.log  ';
      const patterns = parseGitignore(content);

      expect(patterns).toEqual(['node_modules/', '*.log']);
    });

    it('should handle empty content', () => {
      const patterns = parseGitignore('');

      expect(patterns).toEqual([]);
    });

    it('should handle only comments and empty lines', () => {
      const content = '# Comment 1\n\n# Comment 2\n\n';
      const patterns = parseGitignore(content);

      expect(patterns).toEqual([]);
    });

    it('should handle negation patterns', () => {
      const content = '*.log\n!important.log';
      const patterns = parseGitignore(content);

      expect(patterns).toEqual(['*.log', '!important.log']);
    });

    it('should handle mixed content', () => {
      const content = `# Dependencies
node_modules/

# Build output
dist/
build/

# Logs
*.log
!important.log

# OS files
.DS_Store`;

      const patterns = parseGitignore(content);

      expect(patterns).toEqual([
        'node_modules/',
        'dist/',
        'build/',
        '*.log',
        '!important.log',
        '.DS_Store',
      ]);
    });
  });

  describe('shouldIgnoreFile', () => {
    describe('simple patterns', () => {
      it('should match exact file names', () => {
        const patterns = ['.DS_Store'];

        expect(shouldIgnoreFile('.DS_Store', patterns)).toBe(true);
        expect(shouldIgnoreFile('folder/.DS_Store', patterns)).toBe(true);
        expect(shouldIgnoreFile('deep/nested/.DS_Store', patterns)).toBe(true);
        expect(shouldIgnoreFile('other.file', patterns)).toBe(false);
      });

      it('should match directory patterns', () => {
        const patterns = ['node_modules/'];

        expect(shouldIgnoreFile('node_modules/', patterns)).toBe(true);
        expect(shouldIgnoreFile('node_modules/package/', patterns)).toBe(true);
        expect(shouldIgnoreFile('node_modules/package/index.js', patterns)).toBe(true);
        expect(shouldIgnoreFile('src/node_modules/', patterns)).toBe(true);
        expect(shouldIgnoreFile('other/', patterns)).toBe(false);
      });
    });

    describe('wildcard patterns', () => {
      it('should match single asterisk wildcard', () => {
        const patterns = ['*.log'];

        expect(shouldIgnoreFile('error.log', patterns)).toBe(true);
        expect(shouldIgnoreFile('app.log', patterns)).toBe(true);
        expect(shouldIgnoreFile('folder/debug.log', patterns)).toBe(true);
        expect(shouldIgnoreFile('file.txt', patterns)).toBe(false);
      });

      it('should match double asterisk wildcard', () => {
        const patterns = ['**/*.log'];

        // **/*.log contains /, so it becomes (^|/).*[^/]*\.log(/|$)
        // This means it needs at least a '/' before the pattern
        expect(shouldIgnoreFile('logs/error.log', patterns)).toBe(true);
        expect(shouldIgnoreFile('deep/nested/logs/error.log', patterns)).toBe(true);
        expect(shouldIgnoreFile('file.txt', patterns)).toBe(false);
      });

      it('should match question mark wildcard', () => {
        const patterns = ['file?.txt'];

        expect(shouldIgnoreFile('file1.txt', patterns)).toBe(true);
        expect(shouldIgnoreFile('fileA.txt', patterns)).toBe(true);
        expect(shouldIgnoreFile('folder/file2.txt', patterns)).toBe(true);
        expect(shouldIgnoreFile('file.txt', patterns)).toBe(false);
        expect(shouldIgnoreFile('file12.txt', patterns)).toBe(false);
      });
    });

    describe('absolute path patterns', () => {
      it('should match patterns starting with /', () => {
        const patterns = ['/build'];

        expect(shouldIgnoreFile('build', patterns)).toBe(true);
        expect(shouldIgnoreFile('build/', patterns)).toBe(true);
        expect(shouldIgnoreFile('build/index.html', patterns)).toBe(true);
        expect(shouldIgnoreFile('src/build', patterns)).toBe(false);
        expect(shouldIgnoreFile('nested/build', patterns)).toBe(false);
      });
    });

    describe('negation patterns', () => {
      it('should handle negation to un-ignore files', () => {
        const patterns = ['*.log', '!important.log'];

        expect(shouldIgnoreFile('error.log', patterns)).toBe(true);
        expect(shouldIgnoreFile('debug.log', patterns)).toBe(true);
        expect(shouldIgnoreFile('important.log', patterns)).toBe(false);
        expect(shouldIgnoreFile('folder/important.log', patterns)).toBe(false);
      });

      it('should handle negation order', () => {
        const patterns = ['logs/', '!logs/keep.log', 'logs/temp/'];

        expect(shouldIgnoreFile('logs/', patterns)).toBe(true);
        expect(shouldIgnoreFile('logs/error.log', patterns)).toBe(true);
        expect(shouldIgnoreFile('logs/keep.log', patterns)).toBe(false);
        expect(shouldIgnoreFile('logs/temp/', patterns)).toBe(true);
        expect(shouldIgnoreFile('logs/temp/file.log', patterns)).toBe(true);
      });
    });

    describe('complex patterns', () => {
      it('should match patterns with directory separators', () => {
        const patterns = ['build/dist/'];

        expect(shouldIgnoreFile('build/dist/', patterns)).toBe(true);
        expect(shouldIgnoreFile('build/dist/app.js', patterns)).toBe(true);
        expect(shouldIgnoreFile('src/build/dist/', patterns)).toBe(true);
        expect(shouldIgnoreFile('build/', patterns)).toBe(false);
        expect(shouldIgnoreFile('dist/', patterns)).toBe(false);
      });

      it('should handle multiple wildcards', () => {
        const patterns = ['**/node_modules/**'];

        // Pattern contains /, requires at least one parent directory
        expect(shouldIgnoreFile('project/node_modules/', patterns)).toBe(true);
        expect(shouldIgnoreFile('project/node_modules/package/', patterns)).toBe(true);
        expect(shouldIgnoreFile('deep/nested/node_modules/pkg/index.js', patterns)).toBe(true);
      });

      it('should match patterns with special regex characters', () => {
        const patterns = ['file(1).txt', 'data[2].json'];

        expect(shouldIgnoreFile('file(1).txt', patterns)).toBe(true);
        expect(shouldIgnoreFile('folder/file(1).txt', patterns)).toBe(true);
        expect(shouldIgnoreFile('data[2].json', patterns)).toBe(true);
        expect(shouldIgnoreFile('file1.txt', patterns)).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle empty pattern array', () => {
        expect(shouldIgnoreFile('any/file.txt', [])).toBe(false);
      });

      it('should handle empty file path', () => {
        const patterns = ['*.log'];

        expect(shouldIgnoreFile('', patterns)).toBe(false);
      });

      it('should handle file paths with trailing slashes', () => {
        const patterns = ['dist/'];

        expect(shouldIgnoreFile('dist/', patterns)).toBe(true);
        expect(shouldIgnoreFile('dist', patterns)).toBe(true);
      });

      it('should handle deeply nested paths', () => {
        const patterns = ['*.log'];

        const deepPath = 'a/b/c/d/e/f/g/h/i/j/error.log';
        expect(shouldIgnoreFile(deepPath, patterns)).toBe(true);
      });
    });
  });

  describe('findGitignoreFile', () => {
    it('should find .gitignore file by name', () => {
      const files = [
        { name: 'index.js' } as File,
        { name: '.gitignore' } as File,
        { name: 'README.md' } as File,
      ];

      const gitignoreFile = findGitignoreFile(files);

      expect(gitignoreFile).toBeDefined();
      expect(gitignoreFile?.name).toBe('.gitignore');
    });

    it('should find .gitignore file with webkitRelativePath', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/.gitignore' } as any,
        { name: 'file3', webkitRelativePath: 'project/README.md' } as any,
      ];

      const gitignoreFile = findGitignoreFile(files);

      expect(gitignoreFile).toBeDefined();
      expect((gitignoreFile as any)?.webkitRelativePath).toBe('project/.gitignore');
    });

    it('should find .gitignore in nested directory', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/docs/.gitignore' } as any,
      ];

      const gitignoreFile = findGitignoreFile(files);

      expect(gitignoreFile).toBeDefined();
    });

    it('should return undefined if no .gitignore found', () => {
      const files = [
        { name: 'index.js' } as File,
        { name: 'README.md' } as File,
        { name: '.gitkeep' } as File,
      ];

      const gitignoreFile = findGitignoreFile(files);

      expect(gitignoreFile).toBeUndefined();
    });

    it('should return undefined for empty array', () => {
      const gitignoreFile = findGitignoreFile([]);

      expect(gitignoreFile).toBeUndefined();
    });

    it('should return first .gitignore if multiple exist', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/.gitignore' } as any,
        { name: 'file2', webkitRelativePath: 'project/src/.gitignore' } as any,
      ];

      const gitignoreFile = findGitignoreFile(files);

      expect(gitignoreFile).toBeDefined();
      expect((gitignoreFile as any)?.webkitRelativePath).toBe('project/.gitignore');
    });
  });

  describe('readGitignoreContent', () => {
    it('should read file content as text', async () => {
      const mockContent = 'node_modules/\n*.log\ndist/';
      const mockFile = {
        text: async () => mockContent,
      } as File;

      const content = await readGitignoreContent(mockFile);

      expect(content).toBe(mockContent);
    });

    it('should handle empty file', async () => {
      const mockFile = {
        text: async () => '',
      } as File;

      const content = await readGitignoreContent(mockFile);

      expect(content).toBe('');
    });

    it('should handle multiline content', async () => {
      const mockContent = `# Comment
node_modules/

# Build
dist/
*.log`;
      const mockFile = {
        text: async () => mockContent,
      } as File;

      const content = await readGitignoreContent(mockFile);

      expect(content).toBe(mockContent);
    });
  });

  describe('filterFilesByBuiltInBlockList', () => {
    it('should filter out .git directory', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/.git/config' } as any,
        { name: 'file3', webkitRelativePath: 'project/README.md' } as any,
      ];

      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(2);
      expect(filtered.some((f: any) => f.webkitRelativePath.includes('.git'))).toBe(false);
    });

    it('should filter out node_modules directory', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/node_modules/package/index.js' } as any,
        { name: 'file3', webkitRelativePath: 'project/README.md' } as any,
      ];

      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(2);
      expect(filtered.some((f: any) => f.webkitRelativePath.includes('node_modules'))).toBe(false);
    });

    it('should filter out .DS_Store files', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/.DS_Store' } as any,
        { name: 'file3', webkitRelativePath: 'project/src/.DS_Store' } as any,
      ];

      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].webkitRelativePath).toBe('project/src/index.js');
    });

    it('should filter out .pyc files', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/app.py' } as any,
        { name: 'file2', webkitRelativePath: 'project/app.pyc' } as any,
        { name: 'file3', webkitRelativePath: 'project/module.pyc' } as any,
      ];

      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].webkitRelativePath).toBe('project/app.py');
    });

    it('should filter out __pycache__ directory', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/app.py' } as any,
        { name: 'file2', webkitRelativePath: 'project/__pycache__/app.pyc' } as any,
      ];

      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].webkitRelativePath).toBe('project/app.py');
    });

    it('should filter out IDE directories', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/.idea/workspace.xml' } as any,
        { name: 'file3', webkitRelativePath: 'project/.vscode/settings.json' } as any,
      ];

      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].webkitRelativePath).toBe('project/src/index.js');
    });

    it('should handle files without webkitRelativePath', () => {
      const files = [
        { name: 'index.js' } as File,
        { name: '.DS_Store' } as File,
        { name: 'README.md' } as File,
      ];

      const filtered = filterFilesByBuiltInBlockList(files);

      // When file has no webkitRelativePath, path.split('/').slice(1).join('/') = ''
      // Empty string doesn't match patterns, so all files pass through
      expect(filtered).toHaveLength(3);
    });

    it('should return empty array for empty input', () => {
      const filtered = filterFilesByBuiltInBlockList([]);

      expect(filtered).toEqual([]);
    });

    it('should not filter allowed files', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/README.md' } as any,
        { name: 'file3', webkitRelativePath: 'project/package.json' } as any,
      ];

      const filtered = filterFilesByBuiltInBlockList(files);

      expect(filtered).toHaveLength(3);
    });
  });

  describe('filterFilesByGitignore', () => {
    it('should filter files based on gitignore patterns', () => {
      const gitignoreContent = 'node_modules/\n*.log\ndist/';
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/node_modules/pkg/index.js' } as any,
        { name: 'file3', webkitRelativePath: 'project/error.log' } as any,
        { name: 'file4', webkitRelativePath: 'project/dist/bundle.js' } as any,
        { name: 'file5', webkitRelativePath: 'project/README.md' } as any,
      ];

      const filtered = filterFilesByGitignore(files, gitignoreContent);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((f: any) => f.webkitRelativePath)).toEqual([
        'project/src/index.js',
        'project/README.md',
      ]);
    });

    it('should handle negation patterns', () => {
      const gitignoreContent = '*.log\n!important.log';
      const files = [
        { name: 'file1', webkitRelativePath: 'project/error.log' } as any,
        { name: 'file2', webkitRelativePath: 'project/important.log' } as any,
        { name: 'file3', webkitRelativePath: 'project/debug.log' } as any,
      ];

      const filtered = filterFilesByGitignore(files, gitignoreContent);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].webkitRelativePath).toBe('project/important.log');
    });

    it('should handle empty gitignore content', () => {
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/README.md' } as any,
      ];

      const filtered = filterFilesByGitignore(files, '');

      expect(filtered).toHaveLength(2);
    });

    it('should handle gitignore with only comments', () => {
      const gitignoreContent = '# This is a comment\n# Another comment';
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/README.md' } as any,
      ];

      const filtered = filterFilesByGitignore(files, gitignoreContent);

      expect(filtered).toHaveLength(2);
    });

    it('should remove root folder name from path before matching', () => {
      const gitignoreContent = 'src/temp/';
      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/src/temp/cache.txt' } as any,
      ];

      const filtered = filterFilesByGitignore(files, gitignoreContent);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].webkitRelativePath).toBe('project/src/index.js');
    });

    it('should handle complex patterns', () => {
      const gitignoreContent = `# Build output
dist/
build/

# Dependencies
node_modules/

# Logs
*.log
!important.log

# Temp files
temp/
*.tmp`;

      const files = [
        { name: 'file1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'file2', webkitRelativePath: 'project/dist/bundle.js' } as any,
        { name: 'file3', webkitRelativePath: 'project/build/app.js' } as any,
        { name: 'file4', webkitRelativePath: 'project/node_modules/pkg/index.js' } as any,
        { name: 'file5', webkitRelativePath: 'project/error.log' } as any,
        { name: 'file6', webkitRelativePath: 'project/important.log' } as any,
        { name: 'file7', webkitRelativePath: 'project/temp/cache.txt' } as any,
        { name: 'file8', webkitRelativePath: 'project/data.tmp' } as any,
        { name: 'file9', webkitRelativePath: 'project/README.md' } as any,
      ];

      const filtered = filterFilesByGitignore(files, gitignoreContent);

      expect(filtered).toHaveLength(3);
      expect(filtered.map((f: any) => f.webkitRelativePath)).toEqual([
        'project/src/index.js',
        'project/important.log',
        'project/README.md',
      ]);
    });

    it('should handle files without webkitRelativePath', () => {
      const gitignoreContent = '*.log';
      const files = [
        { name: 'index.js' } as File,
        { name: 'error.log' } as File,
        { name: 'README.md' } as File,
      ];

      const filtered = filterFilesByGitignore(files, gitignoreContent);

      // When file has no webkitRelativePath, path.split('/').slice(1).join('/') = ''
      // Empty string doesn't match patterns, so all files pass through
      expect(filtered).toHaveLength(3);
    });

    it('should return empty array for empty file list', () => {
      const filtered = filterFilesByGitignore([], 'node_modules/');

      expect(filtered).toEqual([]);
    });
  });

  describe('integration scenarios', () => {
    it('should correctly filter a realistic project structure', () => {
      const gitignoreContent = `node_modules/
dist/
*.log
!important.log
.env
.DS_Store`;

      const files = [
        { name: 'f1', webkitRelativePath: 'myapp/src/index.ts' } as any,
        { name: 'f2', webkitRelativePath: 'myapp/src/components/Button.tsx' } as any,
        { name: 'f3', webkitRelativePath: 'myapp/node_modules/react/index.js' } as any,
        { name: 'f4', webkitRelativePath: 'myapp/dist/bundle.js' } as any,
        { name: 'f5', webkitRelativePath: 'myapp/error.log' } as any,
        { name: 'f6', webkitRelativePath: 'myapp/important.log' } as any,
        { name: 'f7', webkitRelativePath: 'myapp/.env' } as any,
        { name: 'f8', webkitRelativePath: 'myapp/.DS_Store' } as any,
        { name: 'f9', webkitRelativePath: 'myapp/README.md' } as any,
        { name: 'f10', webkitRelativePath: 'myapp/package.json' } as any,
      ];

      const filtered = filterFilesByGitignore(files, gitignoreContent);

      expect(filtered).toHaveLength(5);
      expect(filtered.map((f: any) => f.webkitRelativePath.split('/').pop())).toEqual([
        'index.ts',
        'Button.tsx',
        'important.log',
        'README.md',
        'package.json',
      ]);
    });

    it('should combine built-in block list with custom gitignore', () => {
      const gitignoreContent = '*.log\ntemp/';

      const files = [
        { name: 'f1', webkitRelativePath: 'project/src/index.js' } as any,
        { name: 'f2', webkitRelativePath: 'project/.git/config' } as any,
        { name: 'f3', webkitRelativePath: 'project/node_modules/pkg/index.js' } as any,
        { name: 'f4', webkitRelativePath: 'project/error.log' } as any,
        { name: 'f5', webkitRelativePath: 'project/temp/cache.txt' } as any,
      ];

      // First apply built-in block list
      let filtered = filterFilesByBuiltInBlockList(files);
      // Then apply gitignore
      filtered = filterFilesByGitignore(filtered, gitignoreContent);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].webkitRelativePath).toBe('project/src/index.js');
    });
  });
});
