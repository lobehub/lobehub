import type { LobeChatDatabase } from '@/database/type';
import { extractFinalReplyImageUrls } from '@/server/services/agentRuntime/finalReplyImages';

import { resolveFileIdsFromUrls } from './extractFileIdsFromEditorData';
import { resolveAttachmentMetadata } from './resolveAttachments';

/**
 * The URLs of every rendered markdown image in `markdown`, in order. Parsed
 * as markdown, so image syntax inside code or escaped stays text.
 */
export const collectMarkdownImageUrls = (markdown?: string | null): string[] => {
  if (!markdown || !markdown.includes('![')) return [];
  return extractFinalReplyImageUrls(markdown);
};

export interface InlineImage {
  id: string;
  url: string;
}

/**
 * Images the user put inline in a message body (an image pasted into the
 * editor is uploaded and kept as `![name](${APP_URL}/f/{fileId})`, not as an
 * attachment). An agent reading the markdown only sees a link, so these are
 * resolved to the user's own image files with a signed storage URL, ready to
 * be handed over as image input.
 *
 * Only the caller's files resolve (scoped by user / workspace); other links,
 * missing files and non-image files are dropped. `excludeIds` skips images
 * already delivered as attachments.
 */
export const resolveInlineImages = async (
  ctx: { db: LobeChatDatabase; userId: string; workspaceId?: string | null },
  markdown: string | null | undefined,
  excludeIds: Iterable<string> = [],
): Promise<InlineImage[]> => {
  const urls = collectMarkdownImageUrls(markdown);
  if (urls.length === 0) return [];

  const scope = { db: ctx.db, userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined };
  const excluded = new Set(excludeIds);
  const fileIds = (await resolveFileIdsFromUrls(urls, scope)).filter((id) => !excluded.has(id));
  if (fileIds.length === 0) return [];

  const items = await resolveAttachmentMetadata({ ...scope, fileIds });
  return items
    .filter((item) => item.fileType.startsWith('image') && !!item.url)
    .map(({ id, url }) => ({ id, url }));
};
