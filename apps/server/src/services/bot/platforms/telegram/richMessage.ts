import { StreamingMarkdownRenderer } from 'chat';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';

import type { BotMessageAttachment } from '../types';
import type { TelegramMediaSource, TelegramRichMediaType } from './mediaSource';
import { resolveTelegramSource, telegramMediaTypeFor } from './mediaSource';

export const TELEGRAM_RICH_MESSAGE_LIMIT = 32_768;
export const TELEGRAM_RICH_MEDIA_LIMIT = 50;
export const TELEGRAM_RICH_BLOCK_LIMIT = 500;
export const TELEGRAM_RICH_UPLOAD_BUDGET = 50 * 1024 * 1024;
export const TELEGRAM_RICH_NESTING_LIMIT = 16;
export const TELEGRAM_RICH_TABLE_COLUMN_LIMIT = 20;

const richMarkdown = remark().use(remarkGfm);

interface MarkdownAstNode {
  align?: Array<string | null>;
  children?: MarkdownAstNode[];
  type: string;
  url?: string;
  value?: string;
}

export interface TelegramInputMedia {
  media: string;
  supports_streaming?: boolean;
  type: TelegramRichMediaType;
}

export interface TelegramInputRichMessageMedia {
  id: string;
  media: TelegramInputMedia;
}

export interface TelegramInputRichMessage {
  markdown: string;
  media?: TelegramInputRichMessageMedia[];
}

export interface TelegramRichUpload {
  buffer: Buffer;
  fieldName: string;
  filename: string;
  mimeType?: string;
}

export interface PreparedTelegramRichMessage {
  droppedAttachments: string[];
  richMessage: TelegramInputRichMessage;
  uploads: TelegramRichUpload[];
}

interface PrepareTelegramRichMessageOptions {
  /**
   * Previously uploaded Telegram `file_id`s, aligned with `attachments`.
   * Missing or empty slots fall back to a download link instead of URL media.
   */
  boundFileIds?: Array<string | undefined>;
  /**
   * Render every attachment as a Markdown download link without registering
   * Rich Message media.
   */
  linksOnly?: boolean;
}

const escapeMarkdownTitle = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');

const escapeMarkdownLabel = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');

const richMediaLink = (mediaType: TelegramRichMediaType, id: string, caption?: string): string => {
  const title = caption?.trim() ? ` "${escapeMarkdownTitle(caption.trim())}"` : '';
  return `![](tg://${mediaType}?id=${id}${title})`;
};

const attachmentFallbackLink = (
  attachment: BotMessageAttachment,
  index: number,
): string | undefined => {
  if (!attachment.fetchUrl) return undefined;
  const label = escapeMarkdownLabel(attachment.name?.trim() || `Attachment ${index + 1}`);
  const url = encodeURI(attachment.fetchUrl).replaceAll('(', '%28').replaceAll(')', '%29');
  return `📎 [${label}](${url})`;
};

const isTelegramRichBlock = (type: string): boolean =>
  type === 'paragraph' ||
  type === 'heading' ||
  type === 'code' ||
  type === 'blockquote' ||
  type === 'list' ||
  type === 'listItem' ||
  type === 'table' ||
  type === 'tableRow' ||
  type === 'thematicBreak' ||
  type === 'definition' ||
  type === 'footnoteDefinition' ||
  type === 'math';

const clipTableColumns = (node: MarkdownAstNode): boolean => {
  if (node.type !== 'table' || !node.children?.length) return false;
  let changed = false;
  if ((node.align?.length ?? 0) > TELEGRAM_RICH_TABLE_COLUMN_LIMIT) {
    node.align = node.align?.slice(0, TELEGRAM_RICH_TABLE_COLUMN_LIMIT);
    changed = true;
  }
  for (const row of node.children) {
    if ((row.children?.length ?? 0) > TELEGRAM_RICH_TABLE_COLUMN_LIMIT) {
      row.children = row.children?.slice(0, TELEGRAM_RICH_TABLE_COLUMN_LIMIT);
      changed = true;
    }
  }
  return changed;
};

const isBlockHtml = (value: string | undefined): boolean => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed.startsWith('<')) return false;
  return /<\/?(?:details|table|thead|tbody|tfoot|tr|td|th|blockquote|pre|div|section|article|ul|ol|li)\b/i.test(
    trimmed,
  );
};

const isTelegramMediaUrl = (node: MarkdownAstNode): boolean =>
  node.type === 'image' && /^tg:\/\/(?:audio|document|photo|video)\?/i.test(node.url ?? '');

const blockHtmlText = (value: string): string =>
  value
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<\/\s*(?:p|div|li|tr|blockquote|pre|details|section|article)\s*>/gi, '\n')
    .replaceAll(/<[^>]*>/g, '')
    .trim();

const clipMarkdownAst = (
  node: MarkdownAstNode,
  budget: { blocks: number; media: number },
  depth: number,
): MarkdownAstNode | undefined => {
  if (depth > TELEGRAM_RICH_NESTING_LIMIT) return undefined;
  if (isTelegramMediaUrl(node)) {
    if (budget.media <= 0) return undefined;
    budget.media -= 1;
  }
  if (node.type === 'html' && isBlockHtml(node.value)) {
    const value = blockHtmlText(node.value ?? '');
    if (!value || budget.blocks <= 0) return undefined;
    budget.blocks -= 1;
    return { children: [{ type: 'text', value }], type: 'paragraph' };
  }
  if (isTelegramRichBlock(node.type)) {
    if (budget.blocks <= 0) return undefined;
    budget.blocks -= 1;
  }
  const columnChanged = clipTableColumns(node);
  if (!node.children?.length) return node;

  const childDepth = node.type === 'root' ? depth : depth + 1;
  const children: MarkdownAstNode[] = [];
  let childrenChanged = columnChanged;
  for (const child of node.children) {
    const clipped = clipMarkdownAst(child, budget, childDepth);
    if (clipped !== child) childrenChanged = true;
    if (clipped) children.push(clipped);
    if (budget.blocks <= 0 && childDepth > 0) {
      if (node.children.indexOf(child) < node.children.length - 1) childrenChanged = true;
      break;
    }
  }
  if (!childrenChanged && children.length === node.children.length) return node;
  return { ...node, children };
};

/**
 * Telegram counts paragraphs, nested blocks, list items, table rows, quotes
 * and details toward a 500-block cap, plus 16 nesting levels and 20 table
 * columns. Character truncation cannot catch a short 501-paragraph reply, so
 * clip the Markdown AST before the character pass. Block-level HTML
 * (`<details>`, `<table>`, …) is reduced to visible text because remark treats
 * those nodes as opaque while Telegram would keep parsing nested content.
 * Inline tags such as `<u>`, `<sub>`, `<sup>` and `<tg-spoiler>` are kept.
 */
export const clipTelegramRichBlocks = (
  markdown: string,
  maxBlocks = TELEGRAM_RICH_BLOCK_LIMIT,
): string => {
  if (!markdown || maxBlocks <= 0) return maxBlocks <= 0 ? '' : markdown;
  const tree = richMarkdown.parse(markdown) as MarkdownAstNode;
  const clipped = clipMarkdownAst(
    tree,
    { blocks: maxBlocks, media: TELEGRAM_RICH_MEDIA_LIMIT },
    0,
  ) ?? { children: [], type: 'root' };
  if (clipped === tree) return markdown;
  return richMarkdown.stringify(clipped as never).trimEnd();
};

export const truncateTelegramRichMarkdown = (
  markdown: string,
  maxCharacters = TELEGRAM_RICH_MESSAGE_LIMIT,
): string => {
  const characters = Array.from(markdown);
  if (characters.length <= maxCharacters) return markdown;
  if (maxCharacters <= 0) return '';

  const ellipsis = '.'.repeat(Math.min(3, maxCharacters));
  let end = maxCharacters - ellipsis.length;
  while (end > 0) {
    const renderer = new StreamingMarkdownRenderer();
    renderer.push(characters.slice(0, end).join(''));
    const rendered = `${renderer.finish()}${ellipsis}`;
    if (Array.from(rendered).length <= maxCharacters) return rendered;
    end -= 1;
  }
  return ellipsis;
};

/** Apply every Telegram Rich Message structural and character limit. */
export const sanitizeTelegramRichMarkdown = (
  markdown: string,
  maxBlocks = TELEGRAM_RICH_BLOCK_LIMIT,
  maxCharacters = TELEGRAM_RICH_MESSAGE_LIMIT,
): string =>
  truncateTelegramRichMarkdown(clipTelegramRichBlocks(markdown, maxBlocks), maxCharacters);

const countTelegramRichMedia = (markdown: string): number =>
  markdown.match(/!?\[[^\]]*\]\(tg:\/\/(?:audio|document|photo|video)\?[^)]*\)/gi)?.length ?? 0;

const inputMediaFromSource = (
  type: TelegramRichMediaType,
  source: TelegramMediaSource,
  fieldName: string,
): { input: TelegramInputMedia; upload?: TelegramRichUpload } => {
  if ('url' in source) {
    return {
      input: {
        media: source.url,
        supports_streaming: type === 'video' ? true : undefined,
        type,
      },
    };
  }

  return {
    input: {
      media: `attach://${fieldName}`,
      supports_streaming: type === 'video' ? true : undefined,
      type,
    },
    upload: {
      buffer: source.buffer,
      fieldName,
      filename: source.filename,
      mimeType: source.mimeType,
    },
  };
};

const attachmentLabel = (attachment: BotMessageAttachment, index: number): string =>
  attachment.name?.trim() || `Attachment ${index + 1}`;

const droppedAttachmentNotice = (names: string[]): string => {
  if (names.length === 0) return '';
  const displayedNames = names.slice(0, 20);
  const list = displayedNames
    .map((name) => escapeMarkdownLabel(Array.from(name).slice(0, 128).join('')))
    .join(', ');
  const remainder = names.length - displayedNames.length;
  const suffix = remainder > 0 ? ` and ${remainder} more` : '';
  return `${list}${suffix} could not be delivered.`;
};

const appendAttachmentFallback = (
  attachmentBlocks: string[],
  droppedAttachments: string[],
  attachment: BotMessageAttachment,
  index: number,
): void => {
  const fallback = attachmentFallbackLink(attachment, index);
  if (fallback && attachmentBlocks.length < TELEGRAM_RICH_BLOCK_LIMIT - 1) {
    attachmentBlocks.push(fallback);
  } else {
    droppedAttachments.push(attachmentLabel(attachment, index));
  }
};

export const prepareTelegramRichMessage = async (
  markdown: string,
  attachments?: BotMessageAttachment[],
  options?: PrepareTelegramRichMessageOptions,
): Promise<PreparedTelegramRichMessage> => {
  const media: TelegramInputRichMessageMedia[] = [];
  const attachmentBlocks: string[] = [];
  const uploads: TelegramRichUpload[] = [];
  const droppedAttachments: string[] = [];
  let uploadBytes = 0;
  const sanitizedInput = sanitizeTelegramRichMarkdown(markdown.trim());
  const availableMedia = Math.max(
    0,
    TELEGRAM_RICH_MEDIA_LIMIT - countTelegramRichMedia(sanitizedInput),
  );

  for (const [index, attachment] of attachments?.entries() ?? []) {
    if (
      media.length >= availableMedia ||
      attachmentBlocks.length >= TELEGRAM_RICH_BLOCK_LIMIT - 1
    ) {
      appendAttachmentFallback(attachmentBlocks, droppedAttachments, attachment, index);
      continue;
    }
    const type = telegramMediaTypeFor(attachment);
    const id = `media_${index}`;
    const fieldName = `file_${index}`;
    const boundFileId = options?.boundFileIds?.[index]?.trim();
    // Telegram already renders a document's uploaded filename in the file
    // card. Repeating it as the Rich media caption produces a duplicate line
    // below that card; photos/video/audio still benefit from an explicit label.
    const mediaBlock = richMediaLink(type, id, type === 'document' ? undefined : attachment.name);
    const nextMediaMarkdown = [...attachmentBlocks, mediaBlock].join('\n\n');
    if (Array.from(nextMediaMarkdown).length > TELEGRAM_RICH_MESSAGE_LIMIT) {
      droppedAttachments.push(attachmentLabel(attachment, index));
      continue;
    }

    if (options?.linksOnly || (options?.boundFileIds && !boundFileId)) {
      appendAttachmentFallback(attachmentBlocks, droppedAttachments, attachment, index);
      continue;
    }

    const source: TelegramMediaSource | undefined = boundFileId
      ? { url: boundFileId }
      : await resolveTelegramSource(attachment, index);
    if (!source) {
      appendAttachmentFallback(attachmentBlocks, droppedAttachments, attachment, index);
      continue;
    }

    const { input, upload } = inputMediaFromSource(type, source, fieldName);
    if (upload && uploadBytes + upload.buffer.byteLength > TELEGRAM_RICH_UPLOAD_BUDGET) {
      appendAttachmentFallback(attachmentBlocks, droppedAttachments, attachment, index);
      continue;
    }
    media.push({ id, media: input });
    attachmentBlocks.push(mediaBlock);
    if (upload) {
      uploads.push(upload);
      uploadBytes += upload.buffer.byteLength;
    }
  }

  const mediaMarkdown = attachmentBlocks.join('\n\n');
  const droppedNotice = truncateTelegramRichMarkdown(droppedAttachmentNotice(droppedAttachments));
  const extraWithNotice = [droppedNotice, mediaMarkdown].filter(Boolean).join('\n\n');
  const extraMarkdown =
    Array.from(extraWithNotice).length <= TELEGRAM_RICH_MESSAGE_LIMIT
      ? extraWithNotice
      : mediaMarkdown;
  const separatorLength = markdown.trim() && extraMarkdown ? 2 : 0;
  const textLimit =
    TELEGRAM_RICH_MESSAGE_LIMIT - Array.from(extraMarkdown).length - separatorLength;
  const textBlockBudget = Math.max(
    0,
    TELEGRAM_RICH_BLOCK_LIMIT - attachmentBlocks.length - (droppedNotice ? 1 : 0),
  );
  const truncatedMarkdown = truncateTelegramRichMarkdown(
    clipTelegramRichBlocks(sanitizedInput, textBlockBudget),
    textLimit,
  );
  const body = [truncatedMarkdown, extraMarkdown].filter(Boolean).join('\n\n');

  return {
    droppedAttachments,
    richMessage: {
      markdown: truncateTelegramRichMarkdown(body),
      ...(media.length > 0 ? { media } : {}),
    },
    uploads,
  };
};
