import type { IEditor } from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import { getFileIdForUrl } from './attachmentRegistry';
import {
  getEditorAttachmentStateFromJson,
  getExistingEditorAttachment,
  insertExistingAttachmentsIntoEditor,
  preservePendingFileNodeSize,
} from './editorAttachments';

describe('getEditorAttachmentStateFromJson', () => {
  it('distinguishes completed attachments from pending and failed uploads', () => {
    expect(
      getEditorAttachmentStateFromJson({
        root: {
          children: [
            {
              fileUrl: 'https://files.example.com/report.pdf',
              status: 'uploaded',
              type: 'file',
            },
            { src: 'blob:pending-image', status: 'loading', type: 'block-image' },
            { message: 'upload failed', status: 'error', type: 'image' },
          ],
        },
      }),
    ).toEqual({ hasCompletedAttachments: true, hasIncompleteAttachments: true });
  });

  it('treats an uploaded image as a completed attachment', () => {
    expect(
      getEditorAttachmentStateFromJson({
        root: {
          children: [
            { src: 'https://files.example.com/image.png', status: 'uploaded', type: 'image' },
          ],
        },
      }),
    ).toEqual({ hasCompletedAttachments: true, hasIncompleteAttachments: false });
  });
});

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
    expect(placeholderFile.size).toBe(attachment.size);
    expect(getExistingEditorAttachment(placeholderFile)).toEqual(attachment);
    expect(getFileIdForUrl(attachment.url)).toBe(attachment.fileId);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('persists the source size on the pending file node', () => {
    const writable = { __size: undefined as number | undefined };
    const fileNode = {
      getType: () => 'file',
      getWritable: () => writable,
      name: 'roadmap.pdf',
      size: undefined,
      status: 'pending',
    };
    const root = {
      getChildren: () => [fileNode],
      getType: () => 'root',
    };
    const file = new File(['content'], 'roadmap.pdf', { type: 'application/pdf' });

    expect(preservePendingFileNodeSize(root as never, file)).toBe(true);
    expect(writable.__size).toBe(file.size);
  });
});
