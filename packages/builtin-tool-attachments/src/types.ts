export const AttachmentsIdentifier = 'lobe-attachments';

export const AttachmentsApiName = {
  readAttachment: 'readAttachment',
} as const;

export type AttachmentsApiNameType = (typeof AttachmentsApiName)[keyof typeof AttachmentsApiName];

export interface ReadAttachmentArgs {
  fileId: string;
  /** Some providers send numeric arguments as strings. */
  limit?: number | string;
  offset?: number | string;
}

export interface ReadAttachmentState {
  endLine?: number;
  error?: string;
  fileId: string;
  filename?: string;
  startLine?: number;
  totalCharCount?: number;
  totalLineCount?: number;
  truncated?: boolean;
}
