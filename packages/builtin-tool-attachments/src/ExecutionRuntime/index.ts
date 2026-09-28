import { readAttachmentContinuation } from '@lobechat/prompts';
import {
  formatTextWindowAttributes,
  formatTextWindowNotice,
  sliceReadWindow,
} from '@lobechat/prompts/textWindow';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { ReadAttachmentArgs, ReadAttachmentState } from '../types';

export interface AttachmentContent {
  content: string;
  error?: string;
  fileId: string;
  filename: string;
  /** Original character count when the stored text was cut at parse time. */
  originalCharCount?: number;
}

export interface AttachmentsRuntimeService {
  /** Resolves parsed text for files the caller may read; ownership is enforced by the host. */
  getFileContents: (fileIds: string[], signal?: AbortSignal) => Promise<AttachmentContent[]>;
}

export class AttachmentsExecutionRuntime {
  private service: AttachmentsRuntimeService;

  constructor(service: AttachmentsRuntimeService) {
    this.service = service;
  }

  async readAttachment(
    args: ReadAttachmentArgs,
    options?: { signal?: AbortSignal },
  ): Promise<BuiltinServerRuntimeOutput> {
    const { fileId, limit, offset } = args;
    if (!fileId) return { content: 'Error: fileId is required', success: false };

    try {
      const [file] = await this.service.getFileContents([fileId], options?.signal);
      if (!file || file.error) {
        const error = file?.error ?? 'File not found';
        const state: ReadAttachmentState = { error, fileId };
        return { content: `<file id="${fileId}" error="${error}" />`, state, success: false };
      }

      const window = sliceReadWindow(file.content, { limit, offset });
      const noticeOptions = {
        continueFrom: readAttachmentContinuation(fileId),
        originalChars: file.originalCharCount,
      };
      const notice = formatTextWindowNotice(window, noticeOptions);

      const state: ReadAttachmentState = {
        endLine: window.endLine,
        fileId,
        filename: file.filename,
        startLine: window.startLine,
        totalCharCount: window.totalChars,
        totalLineCount: window.totalLines,
        truncated: window.truncated,
      };

      return {
        content: `<file id="${fileId}" name="${file.filename}"${formatTextWindowAttributes(window, noticeOptions)}>
${window.content}${notice ? `\n${notice}` : ''}
</file>`,
        state,
        success: true,
      };
    } catch (e) {
      return {
        content: `Error reading attachment: ${(e as Error).message}`,
        error: e,
        success: false,
      };
    }
  }
}
