import type { IEditor } from '@lobehub/editor';
import {
  extractMediaFromEditorState,
  INSERT_FILE_COMMAND,
  INSERT_IMAGE_COMMAND,
} from '@lobehub/editor';
import type { SerializedEditorState } from 'lexical';

import { getFileIdForUrl } from './attachmentRegistry';

/**
 * URLs that have no registered fileId (e.g. externally pasted image URLs)
 * are silently skipped.
 */
export const getAttachmentFileIdsFromJson = (json: unknown): string[] => {
  if (!json) return [];
  const { imageList, fileList } = extractMediaFromEditorState(json as SerializedEditorState);
  const seen = new Set<string>();
  for (const { url } of imageList) {
    const fileId = getFileIdForUrl(url);
    if (fileId) seen.add(fileId);
  }
  for (const { url } of fileList) {
    const fileId = getFileIdForUrl(url);
    if (fileId) seen.add(fileId);
  }
  return [...seen];
};

export const getAttachmentFileIdsFromEditor = (editor: IEditor | undefined): string[] => {
  if (!editor?.getLexicalEditor?.()) return [];
  return getAttachmentFileIdsFromJson(editor.getDocument?.('json'));
};

/**
 * Images → `INSERT_IMAGE_COMMAND`; everything else → `INSERT_FILE_COMMAND`.
 */
export const insertFilesIntoEditor = (editor: IEditor | undefined, files: File[]): void => {
  if (!editor || files.length === 0) return;
  const lexicalEditor = editor.getLexicalEditor?.();
  if (!lexicalEditor) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      lexicalEditor.dispatchCommand(INSERT_IMAGE_COMMAND, { file });
    } else {
      lexicalEditor.dispatchCommand(INSERT_FILE_COMMAND, { file });
    }
  }
};

export const pickAndInsertAttachments = (editor: IEditor | undefined, accept?: string): void => {
  if (!editor?.getLexicalEditor?.()) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (accept) input.accept = accept;

  input.addEventListener('change', () => {
    insertFilesIntoEditor(editor, Array.from(input.files ?? []));
  });

  input.click();
};
