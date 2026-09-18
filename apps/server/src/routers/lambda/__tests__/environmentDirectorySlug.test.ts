import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { describe, expect, it } from 'vitest';

import { environmentDirectorySlug } from '../sandboxWorkspace';

describe('environmentDirectorySlug', () => {
  it('keeps letters of any script, because a Chinese name must not become dashes', () => {
    expect(environmentDirectorySlug('Python 数据分析')).toBe('python-数据分析');
  });

  it('collapses runs of punctuation and whitespace into one dash', () => {
    expect(environmentDirectorySlug('Node  ///  tools')).toBe('node-tools');
  });

  it('strips leading dots, which is also what keeps the reserved .sandbox out of reach', () => {
    expect(environmentDirectorySlug('.sandbox')).toBe('sandbox');
  });

  it('falls back to a word when nothing survives, rather than to an empty path', () => {
    for (const name of ['...', '---', '!!!']) {
      expect(environmentDirectorySlug(name)).toBe('environment');
    }
  });

  it('never trails a dash after the length cap', () => {
    const slug = environmentDirectorySlug(`${'a'.repeat(47)} tail`);

    expect(slug).toHaveLength(47);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('produces a directory the runtime accepts, for every shape above', () => {
    for (const name of [
      'Python 数据分析',
      'Node  ///  tools',
      '.sandbox',
      '...',
      'a'.repeat(200),
    ]) {
      expect(isSafeSandboxCwd(environmentDirectorySlug(name))).toBe(true);
    }
  });
});
