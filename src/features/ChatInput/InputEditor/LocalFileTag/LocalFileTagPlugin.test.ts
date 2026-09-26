import type { IEditor } from '@lobehub/editor';
import { CommonPlugin, Kernel, LitexmlPlugin, MarkdownPlugin, moment } from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import { INSERT_LOCAL_FILE_TAG_COMMAND, LocalFileTagPlugin } from './LocalFileTagPlugin';

vi.mock('@/features/LocalFile', () => ({ LocalFile: () => null }));

const createEditor = (resolveFileStats?: (path: string) => Promise<any>) => {
  const editor = new Kernel() as unknown as IEditor;
  editor.registerPlugins([CommonPlugin, MarkdownPlugin, LitexmlPlugin]);
  editor.registerPlugin(LocalFileTagPlugin, { decorator: () => null, resolveFileStats });
  editor.initNodeEditor();
  return editor;
};

const insertTag = async (editor: IEditor, payload: { isDirectory?: boolean; path: string }) => {
  editor.dispatchCommand(INSERT_LOCAL_FILE_TAG_COMMAND, { name: 'sales.csv', ...payload });
  await moment();
};

describe('LocalFileTagPlugin', () => {
  it('writes file stats into the serialized reference', async () => {
    const resolveFileStats = vi
      .fn()
      .mockResolvedValue({ lineCount: 812_345, mimeType: 'text/csv', size: 52_428_800 });
    const editor = createEditor(resolveFileStats);

    await insertTag(editor, { path: '/Users/me/sales.csv' });

    expect(resolveFileStats).toHaveBeenCalledWith('/Users/me/sales.csv');
    await vi.waitFor(() =>
      expect(editor.getDocument('markdown')).toContain(
        '<localFile name="sales.csv" path="/Users/me/sales.csv" size="52428800" lines="812345" type="text/csv" />',
      ),
    );
  });

  it('keeps the plain reference when stats cannot be resolved', async () => {
    const editor = createEditor(vi.fn().mockRejectedValue(new Error('ENOENT')));

    await insertTag(editor, { path: '/remote/sales.csv' });

    expect(editor.getDocument('markdown')).toContain(
      '<localFile name="sales.csv" path="/remote/sales.csv" />',
    );
  });

  it('does not look up stats for directories', async () => {
    const resolveFileStats = vi.fn();
    const editor = createEditor(resolveFileStats);

    await insertTag(editor, { isDirectory: true, path: '/Users/me/data' });

    expect(resolveFileStats).not.toHaveBeenCalled();
  });
});
