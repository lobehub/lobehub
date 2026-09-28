import type { ChatFileItem } from '@lobechat/types';

import {
  formatTextWindowAttributes,
  formatTextWindowNotice,
  MAX_READ_WINDOW_CHARS,
  sliceTextWindow,
} from '../../textWindow';

/**
 * Attachments whose extracted text exceeds this many characters are previewed instead of inlined.
 *
 * Parsed spreadsheets, CSV exports, and logs can reach 100+ MiB of text. Inlining them overflows
 * every model's context window, and because history re-injects attachments on each turn, the
 * whole topic keeps failing afterwards. Context compression cannot help: the latest user message
 * is always kept intact.
 */
export const FILE_INLINE_MAX_CHARS = 100_000;

/** Leading characters kept as a preview when an attachment exceeds `FILE_INLINE_MAX_CHARS`. */
export const FILE_PREVIEW_CHARS = 4000;

/** The exact `readAttachment` call that continues reading `fileId` from a 1-based line. */
export const readAttachmentContinuation = (fileId: string) => (line: number) =>
  `call readAttachment with fileId="${fileId}" and offset=${line}`;

export interface PreviewLongFileContentOptions {
  /**
   * Whether `readAttachment` is in the tool set sent with this request. Only then does the preview
   * name it as the way to continue; otherwise (custom tool modes, share visitors, clients without
   * the tool) the model would be told to call a tool it does not have.
   */
  canReadAttachment?: boolean;
  /** File id the model passes to `readAttachment` to page through the rest. */
  fileId: string;
  /** Original character count when the stored text was cut at parse time. */
  originalChars?: number;
}

/**
 * Whether a file's text is sent as a preview instead of inlined: it exceeds
 * `FILE_INLINE_MAX_CHARS`, or the stored text is shorter than the original. The database query
 * tool discovery uses to enable `readAttachment` mirrors this predicate.
 */
export const isOversizedFileContent = (contentLength: number, originalChars?: number) =>
  contentLength > FILE_INLINE_MAX_CHARS ||
  (originalChars !== undefined && originalChars > contentLength);

/**
 * Inline a file's text, or replace it with a preview when it exceeds `FILE_INLINE_MAX_CHARS` or
 * its stored text is known to be incomplete. The preview uses the shared text-window contract:
 * attributes report the window and full size, and — when `readAttachment` is available — the
 * notice names the exact call for the next window.
 */
export const previewLongFileContent = (
  content: string,
  { canReadAttachment = false, fileId, originalChars }: PreviewLongFileContentOptions,
) => {
  if (!isOversizedFileContent(content.length, originalChars)) {
    return { attributes: '', body: content };
  }

  const window = sliceTextWindow(content, { maxChars: FILE_PREVIEW_CHARS });
  const options = canReadAttachment
    ? {
        continueFrom: readAttachmentContinuation(fileId),
        continueMaxChars: MAX_READ_WINDOW_CHARS,
        originalChars,
      }
    : { originalChars };
  const notice = formatTextWindowNotice(window, options);
  const preamble = canReadAttachment
    ? '[This is a preview, not the complete file. Do not ask the user to paste the rest.]'
    : '[This is a preview, not the complete file, and no tool to read the rest is available here. Answer from the preview, and tell the user when the answer depends on the omitted part.]';

  return {
    attributes: formatTextWindowAttributes(window, options),
    body: `${window.content}\n${preamble}${notice ? `\n${notice}` : ''}`,
  };
};

const filePrompt = (item: ChatFileItem, addUrl: boolean, canReadAttachment: boolean) => {
  const { attributes, body } = previewLongFileContent(item.content || '', {
    canReadAttachment,
    fileId: item.id,
    originalChars: item.originalCharCount,
  });
  return addUrl
    ? `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}" url="${item.url}"${attributes}>${body}</file>`
    : `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}"${attributes}>${body}</file>`;
};

export const filePrompts = (
  fileList: ChatFileItem[],
  addUrl: boolean,
  canReadAttachment = false,
) => {
  if (fileList.length === 0) return '';

  const prompt = `<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
${fileList.map((item) => filePrompt(item, addUrl, canReadAttachment)).join('\n')}
</files>`;

  return prompt.trim();
};
