/**
 * @vitest-environment happy-dom
 */
import type { IEditor } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCommentSubmit } from './useCommentSubmit';

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  fileIds: [] as string[],
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: any) => unknown) => selector({ addComment: mocks.addComment }),
}));

vi.mock('@/features/EditorCanvas/editorAttachments', () => ({
  getAttachmentFileIdsFromEditor: () => mocks.fileIds,
  getEditorAttachmentStateFromJson: (json: unknown) => ({
    hasCompletedAttachments: false,
    hasIncompleteAttachments: JSON.stringify(json ?? null).includes('"pending"'),
  }),
}));

const JSON_DOC = { root: { type: 'root' } };

const createEditor = () => {
  const doc = { json: JSON_DOC as unknown, markdown: 'looks good' };
  const editor = {
    cleanDocument: vi.fn(() => {
      doc.json = undefined;
      doc.markdown = '';
    }),
    getDocument: (format: string) => (format === 'markdown' ? doc.markdown : doc.json),
    setDocument: vi.fn((format: string, value: unknown) => {
      if (format === 'json') doc.json = value;
      else doc.markdown = String(value);
    }),
  };
  return { doc, editor: editor as unknown as IEditor & typeof editor };
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const setup = (editor: IEditor, canComment = true) => {
  const onContentReset = vi.fn();
  const hook = renderHook(() =>
    useCommentSubmit({ canComment, editor, onContentReset, taskId: 'task-1' }),
  );
  return { hook, onContentReset };
};

describe('useCommentSubmit', () => {
  beforeEach(() => {
    mocks.addComment.mockReset();
    mocks.fileIds = [];
  });

  it('clears the input before the comment request settles', async () => {
    const pending = deferred();
    mocks.addComment.mockReturnValue(pending.promise);
    const { doc, editor } = createEditor();
    const { hook, onContentReset } = setup(editor);

    let submit!: Promise<void>;
    act(() => {
      submit = hook.result.current.submit();
    });

    expect(mocks.addComment).toHaveBeenCalledWith('task-1', 'looks good', { editorData: JSON_DOC });
    expect(doc.markdown).toBe('');
    expect(onContentReset).toHaveBeenLastCalledWith({ hasAttachments: false, hasContent: false });
    expect(hook.result.current.submitting).toBe(true);

    await act(async () => {
      pending.resolve();
      await submit;
    });

    expect(doc.markdown).toBe('');
    expect(editor.setDocument).not.toHaveBeenCalled();
    expect(hook.result.current.submitting).toBe(false);
  });

  it('ignores a second submit while the first is pending', async () => {
    const pending = deferred();
    mocks.addComment.mockReturnValue(pending.promise);
    const { doc, editor } = createEditor();
    const { hook } = setup(editor);

    let first!: Promise<void>;
    act(() => {
      first = hook.result.current.submit();
      doc.markdown = 'looks good';
      void hook.result.current.submit();
    });

    expect(mocks.addComment).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await first;
    });
  });

  it('restores the input when the comment fails to send', async () => {
    mocks.addComment.mockRejectedValue(new Error('network'));
    mocks.fileIds = ['file-1'];
    const { doc, editor } = createEditor();
    const { hook, onContentReset } = setup(editor);

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(editor.setDocument).toHaveBeenCalledWith('json', JSON_DOC);
    expect(doc.json).toEqual(JSON_DOC);
    expect(onContentReset).toHaveBeenLastCalledWith({ hasAttachments: true, hasContent: true });
    expect(hook.result.current.submitting).toBe(false);
  });

  it('keeps a new draft typed while the failed comment was sending', async () => {
    const pending = deferred();
    mocks.addComment.mockReturnValue(pending.promise);
    const { doc, editor } = createEditor();
    const { hook } = setup(editor);

    let submit!: Promise<void>;
    act(() => {
      submit = hook.result.current.submit();
    });
    doc.markdown = 'next comment';

    await act(async () => {
      pending.reject(new Error('network'));
      await submit;
    });

    expect(editor.setDocument).not.toHaveBeenCalled();
    expect(doc.markdown).toBe('next comment');
  });

  it('keeps a new draft whose attachment is still uploading', async () => {
    const pending = deferred();
    mocks.addComment.mockReturnValue(pending.promise);
    const { doc, editor } = createEditor();
    const { hook } = setup(editor);

    let submit!: Promise<void>;
    act(() => {
      submit = hook.result.current.submit();
    });
    const uploading = { root: { children: [{ status: 'pending', type: 'file' }], type: 'root' } };
    doc.json = uploading;

    await act(async () => {
      pending.reject(new Error('network'));
      await submit;
    });

    expect(editor.setDocument).not.toHaveBeenCalled();
    expect(doc.json).toBe(uploading);
  });

  it('does nothing without permission or content', async () => {
    const { editor } = createEditor();
    const denied = setup(editor, false).hook;
    await act(async () => {
      await denied.result.current.submit();
    });

    const empty = createEditor();
    empty.doc.markdown = '  ';
    const blank = setup(empty.editor).hook;
    await act(async () => {
      await blank.result.current.submit();
    });

    expect(mocks.addComment).not.toHaveBeenCalled();
    expect(editor.cleanDocument).not.toHaveBeenCalled();
    expect(empty.editor.cleanDocument).not.toHaveBeenCalled();
  });
});
