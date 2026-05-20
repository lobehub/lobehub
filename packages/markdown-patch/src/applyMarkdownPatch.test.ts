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

  it('formats INVALID_LINE_RANGE', () => {
    const msg = formatMarkdownPatchError({ code: 'INVALID_LINE_RANGE', hunkIndex: 0 });
    expect(msg).toMatch(/endLine < startLine/);
  });

  it('formats LINE_OUT_OF_RANGE', () => {
    const msg = formatMarkdownPatchError({
      code: 'LINE_OUT_OF_RANGE',
      hunkIndex: 1,
      totalLines: 4,
    });
    expect(msg).toMatch(/\[1, 4\]/);
    expect(msg).toMatch(/line 5/);
  });

  it('formats LINE_OVERLAP', () => {
    const msg = formatMarkdownPatchError({ code: 'LINE_OVERLAP', hunkIndex: 2 });
    expect(msg).toMatch(/Hunk #2/);
    expect(msg).toMatch(/overlaps/);
  });
});

describe('applyMarkdownPatch - structured ops', () => {
  it('delete mode removes matched region', () => {
    const source = 'one\ntwo\nthree\n';
    const result = applyMarkdownPatch(source, [{ mode: 'delete', search: 'two\n' }]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe('one\nthree\n');
      expect(result.applied).toBe(1);
    }
  });

  it('delete mode rejects ambiguous without replaceAll', () => {
    const result = applyMarkdownPatch('x\nx\n', [{ mode: 'delete', search: 'x\n' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('HUNK_AMBIGUOUS');
  });

  it('deleteLines removes inclusive range', () => {
    const source = 'a\nb\nc\nd\n';
    const result = applyMarkdownPatch(source, [{ endLine: 3, mode: 'deleteLines', startLine: 2 }]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('a\nd\n');
  });

  it('deleteLines rejects endLine < startLine', () => {
    const source = 'a\nb\n';
    const result = applyMarkdownPatch(source, [{ endLine: 1, mode: 'deleteLines', startLine: 2 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_LINE_RANGE');
  });

  it('deleteLines rejects out-of-range', () => {
    const source = 'a\nb\n';
    const result = applyMarkdownPatch(source, [{ endLine: 5, mode: 'deleteLines', startLine: 1 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LINE_OUT_OF_RANGE');
  });

  it('insertAt inserts before given line (1-based)', () => {
    const source = 'a\nb\nc\n';
    const result = applyMarkdownPatch(source, [{ content: 'X', line: 2, mode: 'insertAt' }]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('a\nX\nb\nc\n');
  });

  it('insertAt at totalLines + 1 appends to end', () => {
    const source = 'a\nb\nc';
    const result = applyMarkdownPatch(source, [{ content: 'Z', line: 4, mode: 'insertAt' }]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('a\nb\nc\nZ');
  });

  it('insertAt at line 1 prepends', () => {
    const source = 'a\nb\n';
    const result = applyMarkdownPatch(source, [{ content: 'HEAD', line: 1, mode: 'insertAt' }]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('HEAD\na\nb\n');
  });

  it('insertAt rejects line out of range', () => {
    const source = 'a\nb\n';
    const result = applyMarkdownPatch(source, [{ content: 'X', line: 5, mode: 'insertAt' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LINE_OUT_OF_RANGE');
  });

  it('replaceLines swaps inclusive range', () => {
    const source = 'one\ntwo\nthree\nfour\n';
    const result = applyMarkdownPatch(source, [
      { content: 'TWO\nTHREE', endLine: 3, mode: 'replaceLines', startLine: 2 },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('one\nTWO\nTHREE\nfour\n');
  });

  it('applies content-based hunks before line-based hunks', () => {
    const source = 'header\nbody\nfoot\n';
    const result = applyMarkdownPatch(source, [
      { endLine: 2, mode: 'deleteLines', startLine: 2 },
      { mode: 'replace', replace: 'HEADER', search: 'header' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('HEADER\nfoot\n');
  });

  it('applies multiple line hunks in descending order so lower-line hunks stay correct', () => {
    const source = 'L1\nL2\nL3\nL4\nL5\n';
    const result = applyMarkdownPatch(source, [
      { endLine: 2, mode: 'deleteLines', startLine: 2 },
      { content: 'INS', line: 4, mode: 'insertAt' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // insertAt 4 applied against original (before deleteLines) -> between L3 and L4
      // deleteLines [2,2] applied after -> removes L2
      expect(result.content).toBe('L1\nL3\nINS\nL4\nL5\n');
    }
  });

  it('rejects overlapping line hunks', () => {
    const source = 'a\nb\nc\nd\n';
    const result = applyMarkdownPatch(source, [
      { endLine: 3, mode: 'deleteLines', startLine: 2 },
      { content: 'X', line: 3, mode: 'insertAt' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LINE_OVERLAP');
  });

  it('reports invalid line range before overlap when a hunk has startLine < 1', () => {
    const source = 'a\nb\nc\n';
    const result = applyMarkdownPatch(source, [
      { endLine: 1, mode: 'deleteLines', startLine: 0 },
      { content: 'X', line: 1, mode: 'insertAt' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LINE_OUT_OF_RANGE');
  });

  it('reports invalid line range before overlap when endLine < startLine', () => {
    const source = 'a\nb\nc\n';
    const result = applyMarkdownPatch(source, [
      { endLine: 1, mode: 'deleteLines', startLine: 3 },
      { content: 'X', line: 2, mode: 'insertAt' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_LINE_RANGE');
  });

  it('defaults mode to replace when omitted (backward compat)', () => {
    const source = 'hello';
    const result = applyMarkdownPatch(source, [{ replace: 'world', search: 'hello' }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('world');
  });
});
