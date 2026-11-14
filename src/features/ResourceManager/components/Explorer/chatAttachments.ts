import {
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  DERIVED_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';

import { type UploadFileItem } from '@/types/files/upload';
import { type ResourceItem } from '@/types/resource';

type ChatAttachableResource = Pick<
  ResourceItem,
  'fileId' | 'fileType' | 'id' | 'name' | 'size' | 'sourceType' | 'url'
>;

const PDF_OR_OFFICE_NAME = /\.(?:pdf|xlsx?|docx?|pptx?|odt)$/i;

/**
 * Only uploaded files can ride along a chat message. Folders are not files, and
 * neither are pages, even the ones a placeholder file row lists under
 * `sourceType: 'file'`. PDF and Office uploads stay files, the same rule the
 * row menu uses for "Send to chat platform".
 */
export const isChatAttachableResource = (resource: ChatAttachableResource): boolean => {
  if (resource.fileType === CUSTOM_FOLDER_FILE_TYPE) return false;
  if (resource.sourceType !== 'file' && !resource.fileId) return false;

  const isPdfOrOffice =
    resource.fileType?.toLowerCase() === 'pdf' || PDF_OR_OFFICE_NAME.test(resource.name ?? '');
  if (isPdfOrOffice) return true;

  return (
    resource.sourceType !== DERIVED_DOCUMENT_SOURCE_TYPE &&
    resource.fileType !== CUSTOM_DOCUMENT_FILE_TYPE
  );
};

export interface ChatAttachmentsResult {
  /** Selected files the composer already holds; they count as added. */
  alreadyAdded: number;
  files: UploadFileItem[];
  /** Selected folders and pages, which cannot be attached. */
  skipped: number;
}

/**
 * Turn selected library rows into composer attachments for files that are
 * already uploaded. Send only needs the file id; the name, type and url feed
 * the attachment preview.
 */
export const buildChatAttachments = (
  resources: ChatAttachableResource[],
  existingFileIds: Iterable<string> = [],
): ChatAttachmentsResult => {
  const existing = new Set(existingFileIds);
  const seen = new Set<string>();
  const files: UploadFileItem[] = [];
  let alreadyAdded = 0;
  let skipped = 0;

  for (const resource of resources) {
    if (!isChatAttachableResource(resource)) {
      skipped += 1;
      continue;
    }

    // A file that backs a parsed page is listed under the page id.
    const fileId = resource.fileId || resource.id;
    if (seen.has(fileId)) continue;
    seen.add(fileId);

    if (existing.has(fileId)) {
      alreadyAdded += 1;
      continue;
    }

    const url = resource.url || undefined;
    files.push({
      file: { name: resource.name, size: resource.size, type: resource.fileType } as File,
      fileUrl: url,
      id: fileId,
      previewUrl: url,
      // The library still owns the file: removing it from the input must not delete it.
      skipRemoveFile: true,
      status: 'success',
    });
  }

  return { alreadyAdded, files, skipped };
};
