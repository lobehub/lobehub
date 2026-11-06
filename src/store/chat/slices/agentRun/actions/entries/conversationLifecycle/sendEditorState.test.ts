import { describe, expect, it, vi } from 'vitest';

import { readSendEditorState, restoreSendEditorState } from './sendEditorState';

describe('send editor recovery', () => {
  it('reads and restores a native editor document, including attachment nodes', () => {
    const draft = { root: { children: [{ fileId: 'file_1', type: 'file' }] } };
    const editor = { getDocument: vi.fn(() => draft), setDocument: vi.fn() };

    expect(readSendEditorState(editor)).toEqual(draft);
    restoreSendEditorState(editor, draft, 'message');

    expect(editor.setDocument).toHaveBeenCalledWith('json', JSON.stringify(draft));
  });

  it('preserves the wrapper API and falls back to markdown without a snapshot', () => {
    const draft = { root: { children: [] } };
    const editor = {
      getJSONState: vi.fn(() => draft),
      setDocument: vi.fn(),
      setJSONState: vi.fn(),
    };

    expect(readSendEditorState(editor)).toEqual(draft);
    restoreSendEditorState(editor, draft, 'message');
    expect(editor.setJSONState).toHaveBeenCalledWith(draft);
    restoreSendEditorState(editor, undefined, 'message');
    expect(editor.setDocument).toHaveBeenCalledWith('markdown', 'message');
  });

  it('does not interrupt message cleanup when the editor has unmounted', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const editor = {
      getDocument: vi.fn(() => {
        throw new Error('editor destroyed');
      }),
      setDocument: vi.fn(() => {
        throw new Error('editor destroyed');
      }),
    };

    expect(readSendEditorState(editor)).toBeUndefined();
    expect(() => restoreSendEditorState(editor, { root: {} }, 'message')).not.toThrow();
    log.mockRestore();
  });
});
