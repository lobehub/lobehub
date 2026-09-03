import { describe, expect, it } from 'vitest';

import { extractToolKeyword } from './extractToolKeyword';

describe('extractToolKeyword', () => {
  it('returns undefined for missing or empty args', () => {
    expect(extractToolKeyword()).toBeUndefined();
    expect(extractToolKeyword({})).toBeUndefined();
  });

  describe('command args', () => {
    it('skips env setup and runners to find the script being run', () => {
      expect(
        extractToolKeyword({
          command:
            'set -a && source .env && set +a && npx tsx scripts/gross-margin/monthly.ts 2>/dev/null',
        }),
      ).toBe('monthly.ts');
    });

    it('returns the program for a plain command', () => {
      expect(extractToolKeyword({ command: 'git status' })).toBe('git');
    });

    it('skips env assignments and sudo', () => {
      expect(extractToolKeyword({ command: 'FOO=1 sudo systemctl restart nginx' })).toBe(
        'systemctl',
      );
    });

    it('prefers command over the model-written description', () => {
      expect(
        extractToolKeyword({ command: 'ls -la', description: 'List files in current directory' }),
      ).toBe('ls');
    });
  });

  describe('query and pattern args', () => {
    it('prefers pattern over path for grep-style calls', () => {
      expect(extractToolKeyword({ path: '/repo/src', pattern: 'TodoListRender' })).toBe(
        'TodoListRender',
      );
    });

    it('truncates long queries', () => {
      const query = 'a'.repeat(50);
      const keyword = extractToolKeyword({ query });
      expect(keyword).toBe('a'.repeat(32) + '…');
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
