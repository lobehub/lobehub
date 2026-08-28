import { describe, expect, it } from 'vitest';

import { buildReadFileState } from './buildReadFileState';

describe('buildReadFileState', () => {
  it('keeps the card for a successful builtin read of an empty file', () => {
    const state = buildReadFileState({
      args: { path: '/repo/empty.txt' },
      identifier: 'lobe-local-system',
      parsedContent: { content: '' },
      pluginState: { charCount: 0, content: '', fileType: 'txt', path: '/repo/empty.txt' },
    });

    expect(state).toMatchObject({ charCount: 0, content: '', path: '/repo/empty.txt' });
  });

  it('keeps the card for an OpenCode empty-file read confirmed by the envelope', () => {
    const state = buildReadFileState({
      args: { filePath: '/repo/empty.txt' },
      identifier: 'opencode',
      parsedContent: { content: '', hasEnvelope: true },
    });

    expect(state).toMatchObject({ charCount: 0, content: '', path: '/repo/empty.txt' });
  });

  it('returns nothing for unconfirmed empty content', () => {
    const state = buildReadFileState({
      args: { filePath: '/repo/file.txt' },
      identifier: 'opencode',
      parsedContent: { content: '' },
    });

    expect(state).toBeUndefined();
  });

  it('returns nothing when the tool errored', () => {
    const state = buildReadFileState({
      args: { path: '/repo/file.txt' },
      identifier: 'opencode',
      parsedContent: { content: 'boom', hasEnvelope: true },
      pluginError: new Error('boom'),
    });

    expect(state).toBeUndefined();
  });

  it('falls back to raw content only for heterogeneous CLI identifiers', () => {
    const fromPi = buildReadFileState({
      args: { file_path: '/repo/file.ts' },
      identifier: 'pi',
      parsedContent: { content: 'const a = 1;' },
    });
    const fromBuiltin = buildReadFileState({
      args: { path: '/repo/file.ts' },
      identifier: 'lobe-local-system',
      parsedContent: { content: 'const a = 1;' },
    });

    expect(fromPi).toMatchObject({ content: 'const a = 1;', fileType: 'ts' });
    expect(fromBuiltin).toBeUndefined();
  });

  it('derives loc from offset and limit args', () => {
    const state = buildReadFileState({
      args: { limit: 10, offset: 5, path: '/repo/file.ts' },
      identifier: 'opencode',
      parsedContent: { content: 'line', hasEnvelope: true },
    });

    expect(state?.loc).toEqual([5, 14]);
  });
});
