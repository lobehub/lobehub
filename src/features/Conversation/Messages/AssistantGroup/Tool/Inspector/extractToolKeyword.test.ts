import { describe, expect, it } from 'vitest';

import { extractToolKeyword } from './extractToolKeyword';

describe('extractToolKeyword', () => {
  it('returns undefined for missing or empty args', () => {
    expect(extractToolKeyword()).toBeUndefined();
    expect(extractToolKeyword({})).toBeUndefined();
  });

  describe('command args', () => {
    it('drops setup statements and output plumbing from the command line', () => {
      expect(
        extractToolKeyword({
          command:
            'set -a && source .env && set +a && npx tsx scripts/gross-margin/monthly.ts 2>/dev/null',
        }),
      ).toBe('npx tsx scripts/gross-margin/monthly.ts');
    });

    it('returns the whole command for a plain command', () => {
      expect(extractToolKeyword({ command: 'git status' })).toBe('git status');
    });

    it('names a heredoc by its opener line instead of a single token', () => {
      expect(
        extractToolKeyword({
          command: "cd /repo && python3 - <<'EOF'\nprint('hi')\nEOF",
        }),
      ).toBe("python3 - <<'EOF'");
    });

    it('keeps an inline environment prefix', () => {
      expect(extractToolKeyword({ command: 'FOO=1 sudo systemctl restart nginx' })).toBe(
        'FOO=1 sudo systemctl restart nginx',
      );
    });

    it('prefers the model-written description over command fragments', () => {
      expect(
        extractToolKeyword({ command: 'ls -la', description: 'List files in current directory' }),
      ).toBe('List files in current directory');
    });

    it('falls back to the command line when no description exists', () => {
      expect(extractToolKeyword({ command: 'ls -la' })).toBe('ls -la');
    });
  });

  describe('query and pattern args', () => {
    it('prefers pattern over path for grep-style calls', () => {
      expect(extractToolKeyword({ path: '/repo/src', pattern: 'TodoListRender' })).toBe(
        'TodoListRender',
      );
    });

    it('keeps long queries intact for CSS truncation', () => {
      const query = 'a'.repeat(50);
      expect(extractToolKeyword({ query })).toBe(query);
    });
  });

  describe('path args', () => {
    it('returns the basename for file tools', () => {
      expect(extractToolKeyword({ file_path: '/repo/packages/database/src/message.ts' })).toBe(
        'message.ts',
      );
    });

    it('handles windows separators', () => {
      expect(extractToolKeyword({ path: String.raw`C:\repo\src\index.tsx` })).toBe('index.tsx');
    });
  });

  describe('url args', () => {
    it('returns the hostname', () => {
      expect(extractToolKeyword({ url: 'https://lobehub.com/docs/changelog' })).toBe('lobehub.com');
    });

    it('takes the first entry of a url array', () => {
      expect(extractToolKeyword({ urls: ['https://example.com/a', 'https://other.dev/b'] })).toBe(
        'example.com',
      );
    });
  });

  it('falls back to name-like args', () => {
    expect(extractToolKeyword({ skill: 'local-testing' })).toBe('local-testing');
  });
});
