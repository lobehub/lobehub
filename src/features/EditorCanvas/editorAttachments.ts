import type { IEditor } from '@lobehub/editor';
import {
  extractMediaFromEditorState,
  INSERT_FILE_COMMAND,
  INSERT_IMAGE_COMMAND,
} from '@lobehub/editor';
import type { ElementNode, LexicalNode, SerializedEditorState } from 'lexical';
import { $getRoot, $getSelection, $isElementNode, $isRangeSelection } from 'lexical';

import { getFileIdForUrl, registerAttachment } from './attachmentRegistry';

export interface ExistingEditorAttachment {
  fileId: string;
  fileType: string;
  name: string;
  size: number;
  url: string;
}

const existingAttachmentByFile = new WeakMap<File, ExistingEditorAttachment>();

interface FileNodeWithSize {
  __size?: number;
  getWritable: () => FileNodeWithSize;
  name: string;
  size?: number;
  status?: 'pending' | 'uploaded' | 'error';
}

export interface EditorAttachmentState {
  hasCompletedAttachments: boolean;
  hasIncompleteAttachments: boolean;
}

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const getEditorAttachmentStateFromJson = (json: unknown): EditorAttachmentState => {
  const pending: unknown[] = [json];
  let hasCompletedAttachments = false;
  let hasIncompleteAttachments = false;

  while (pending.length > 0) {
    const node = toRecord(pending.pop());
    if (!node) continue;

    const isFile = node.type === 'file';
    const isImage = node.type === 'image' || node.type === 'block-image';
    if (isFile || isImage) {
      const url = isFile ? node.fileUrl : node.src;
      if (node.status === 'uploaded' && typeof url === 'string' && url.length > 0) {
        hasCompletedAttachments = true;
      } else {
        hasIncompleteAttachments = true;
      }
    }

    if (Array.isArray(node.children)) pending.push(...node.children);
    if (node.root) pending.push(node.root);
  }

  return { hasCompletedAttachments, hasIncompleteAttachments };
};

export const getExistingEditorAttachment = (file: File): ExistingEditorAttachment | undefined =>
  existingAttachmentByFile.get(file);

const getChildren = (node: LexicalNode): LexicalNode[] =>
  'getChildren' in node ? (node as ElementNode).getChildren() : [];

/**
 * The editor's file command currently creates its node with only the filename.
 * It invokes the upload handler from the same Lexical update, so persist the
 * source File size on that newly inserted pending node before the upload starts.
 */
export const preservePendingFileNodeSize = (root: LexicalNode, file: File): boolean => {
  const pending: LexicalNode[] = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;

    if (node.getType() === 'file') {
      const fileNode = node as unknown as FileNodeWithSize;
      if (
        fileNode.name === file.name &&
        fileNode.status === 'pending' &&
        fileNode.size === undefined
      ) {
        fileNode.getWritable().__size = file.size;
        return true;
      }
    }
    pending.push(...getChildren(node));
  }

  return false;
};

export const preserveInsertedFileSize = (file: File): void => {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    const anchorNode = selection.anchor.getNode();
    const candidate = $isElementNode(anchorNode)
      ? anchorNode.getChildAtIndex(selection.anchor.offset - 1)
      : anchorNode.getPreviousSibling();
    if (candidate && preservePendingFileNodeSize(candidate, file)) return;
  }

  preservePendingFileNodeSize($getRoot(), file);
};

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
  // File picker / Upload dropdown steals focus; restore it so the cursor
  // remains visible and the user can keep typing.
  editor.focus?.();
};

/**
 * Insert already-uploaded library files without downloading or uploading them again.
 * The editor's file plugin still receives a `File`, while the upload adapter resolves
 * that placeholder straight back to the existing resource URL and file id.
 */
export const insertExistingAttachmentsIntoEditor = (
  editor: IEditor | undefined,
  attachments: ExistingEditorAttachment[],
): void => {
  if (!editor || attachments.length === 0) return;
  const lexicalEditor = editor.getLexicalEditor?.();
  if (!lexicalEditor) return;

  for (const attachment of attachments) {
    const file = new File([], attachment.name, { type: attachment.fileType });
    Object.defineProperty(file, 'size', { value: attachment.size });
    existingAttachmentByFile.set(file, attachment);
    registerAttachment(attachment.url, attachment.fileId);
    lexicalEditor.dispatchCommand(INSERT_FILE_COMMAND, { file });
  }

  editor.focus?.();
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
