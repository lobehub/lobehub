import { WORKSPACE_FILE_DRAG_MIME } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { readWorkspaceFileDragData, writeWorkspaceFileDragData } from './workspaceFileDragData';

describe('workspaceFileDragData', () => {
  it('round-trips a file payload through the custom MIME', () => {
    const dt = new DataTransfer();
    writeWorkspaceFileDragData(dt, {
      isDirectory: false,
      name: 'index.zh.mdx',
      path: '/repo/docs/index.zh.mdx',
    });

    expect(dt.types).toContain(WORKSPACE_FILE_DRAG_MIME);
    expect(dt.effectAllowed).toBe('copy');
    expect(readWorkspaceFileDragData(dt)).toEqual({
      isDirectory: false,
      name: 'index.zh.mdx',
      path: '/repo/docs/index.zh.mdx',
    });
  });

  it('preserves the isDirectory flag for folders', () => {
    const dt = new DataTransfer();
    writeWorkspaceFileDragData(dt, { isDirectory: true, name: 'docs', path: '/repo/docs' });
    expect(readWorkspaceFileDragData(dt)?.isDirectory).toBe(true);
  });

  it('returns undefined when the custom MIME is absent (no false trigger)', () => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'just text');
    expect(readWorkspaceFileDragData(dt)).toBeUndefined();
  });

  it('returns undefined for malformed payloads', () => {
    const dt = new DataTransfer();
    dt.setData(WORKSPACE_FILE_DRAG_MIME, '{ not json');
    expect(readWorkspaceFileDragData(dt)).toBeUndefined();
  });

  it('rejects a payload without a path', () => {
    const dt = new DataTransfer();
    dt.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify({ name: 'x' }));
    expect(readWorkspaceFileDragData(dt)).toBeUndefined();
  });

  it('falls back to the path when name is missing', () => {
    const dt = new DataTransfer();
    dt.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify({ path: '/repo/a.ts' }));
    expect(readWorkspaceFileDragData(dt)).toEqual({
      isDirectory: false,
      name: '/repo/a.ts',
      path: '/repo/a.ts',
    });
  });
});
