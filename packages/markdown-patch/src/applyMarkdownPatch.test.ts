import { describe, expect, it } from 'vitest';

import { applyMarkdownPatch } from './applyMarkdownPatch';
import { formatMarkdownPatchError } from './formatPatchError';

describe('applyMarkdownPatch', () => {
  it('replaces a single unique hunk', () => {
    const source = '# Title\n\nHello world\n';
    const result = applyMarkdownPatch(source, [{ replace: 'Hello there', search: 'Hello world' }]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe('# Title\n\nHello there\n');
      expect(result.applied).toBe(1);
    }
  });

  it('applies multiple hunks sequentially where later hunks see earlier results', () => {
    const source = 'alpha\nbeta\ngamma\n';
    const result = applyMarkdownPatch(source, [
      { replace: 'ALPHA', search: 'alpha' },
      { replace: 'DELTA', search: 'ALPHA' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe('DELTA\nbeta\ngamma\n');
      expect(result.applied).toBe(2);
    }
  });

  it('rejects a hunk not found', () => {
    const source = 'one two three';
    const result = applyMarkdownPatch(source, [{ replace: 'X', search: 'four' }]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HUNK_NOT_FOUND');
      expect(result.error.hunkIndex).toBe(0);
    }
  });

  it('rejects ambiguous hunks when replaceAll is not set', () => {
    const source = 'foo bar foo';
    const result = applyMarkdownPatch(source, [{ replace: 'baz', search: 'foo' }]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HUNK_AMBIGUOUS');
      expect(result.error.occurrences).toBe(2);
    }
  });

  it('replaces all occurrences when replaceAll=true', () => {
    const source = 'foo bar foo baz foo';
    const result = applyMarkdownPatch(source, [
      { replace: 'qux', replaceAll: true, search: 'foo' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe('qux bar qux baz qux');
      expect(result.applied).toBe(3);
    }
  });

  it('rejects empty hunks array', () => {
    const result = applyMarkdownPatch('doc', []);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY_HUNKS');
  });

  it('rejects empty search', () => {
    const result = applyMarkdownPatch('doc', [{ replace: 'x', search: '' }]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EMPTY_SEARCH');
      expect(result.error.hunkIndex).toBe(0);
    }
  });

  it('aborts on first failing hunk without applying later ones', () => {
    const source = 'keep me';
    const result = applyMarkdownPatch(source, [
      { replace: 'X', search: 'nope' },
      { replace: 'changed', search: 'keep me' },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.hunkIndex).toBe(0);
  });

  it('preserves byte-exact whitespace differences (strict by design)', () => {
    const source = '- item one\n- item two\n';
    const result = applyMarkdownPatch(source, [{ replace: '- item alpha', search: '-  item one' }]);

    expect(result.ok).toBe(false);
  });

  it('supports multi-line search and replace blocks', () => {
    const source = '## A\ntext\n\n## B\nmore\n';
    const result = applyMarkdownPatch(source, [
      { replace: '## A\ntext\nnew line\n', search: '## A\ntext\n' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('## A\ntext\nnew line\n\n## B\nmore\n');
  });
});

describe('formatMarkdownPatchError', () => {
  it('formats HUNK_NOT_FOUND with index hint', () => {
    const msg = formatMarkdownPatchError({
      code: 'HUNK_NOT_FOUND',
      hunkIndex: 2,
      search: 'abc',
    });
    expect(msg).toMatch(/Hunk #2/);
    expect(msg).toMatch(/byte-exact/);
  });

  it('formats HUNK_AMBIGUOUS with occurrence count', () => {
    const msg = formatMarkdownPatchError({
      code: 'HUNK_AMBIGUOUS',
      hunkIndex: 0,
      occurrences: 3,
    });
    expect(msg).toMatch(/matches 3 locations/);
    expect(msg).toMatch(/replaceAll=true/);
  });

  it('formats EMPTY_SEARCH', () => {
    const msg = formatMarkdownPatchError({ code: 'EMPTY_SEARCH', hunkIndex: 1 });
    expect(msg).toMatch(/Hunk #1/);
    expect(msg).toMatch(/empty search/);
  });

  it('formats EMPTY_HUNKS', () => {
    const msg = formatMarkdownPatchError({ code: 'EMPTY_HUNKS', hunkIndex: -1 });
    expect(msg).toMatch(/No hunks/);
  });
});
