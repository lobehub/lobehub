import type { IEditor } from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import { getFileIdForUrl } from './attachmentRegistry';
import {
  getExistingEditorAttachment,
  insertExistingAttachmentsIntoEditor,
} from './editorAttachments';

describe('insertExistingAttachmentsIntoEditor', () => {
  it('marks library resources for reuse instead of uploading them again', () => {
    const dispatchCommand = vi.fn();
    const focus = vi.fn();
    const editor = {
      focus,
      getLexicalEditor: () => ({ dispatchCommand }),
    } as unknown as IEditor;
    const attachment = {
      fileId: 'file-library-1',
      fileType: 'application/pdf',
      name: 'roadmap.pdf',
      size: 2048,
      url: 'https://files.example.com/roadmap.pdf',
    };

    insertExistingAttachmentsIntoEditor(editor, [attachment]);

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    const placeholderFile = dispatchCommand.mock.calls[0][1].file as File;
    expect(placeholderFile).toBeInstanceOf(File);
    expect(placeholderFile.name).toBe(attachment.name);
    expect(getExistingEditorAttachment(placeholderFile)).toEqual(attachment);
    expect(getFileIdForUrl(attachment.url)).toBe(attachment.fileId);
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
