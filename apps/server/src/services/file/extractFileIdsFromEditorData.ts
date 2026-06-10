import { files } from '@lobechat/database/schemas';
import { and, inArray } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';
import { buildWorkspaceWhere } from '@/database/utils/workspace';

/**
 * Walks a serialized Lexical editor state, collects every URL referenced by
 * image / file nodes, and resolves them to fileIds.
 *
 * Two resolution paths because `getFileAccessUrl` returns different URL forms:
 *
 *   - **Prod / non-dev**: `${APP_URL}/f/{fileId}` proxy URL — fileId recovered
 *     by regex without touching the DB.
 *   - **Local dev** (and historical cloud data): pre-signed storage URLs whose
 *     path contains the file's S3 key. fileId recovered by querying `files`
 *     where `url` matches the key extracted from the URL pathname.
 *
 * Permissive about `status`: real-world editor nodes (cloud + historical data)
 * frequently omit the field, so we treat a missing `status` as uploaded.
 */

const FILE_PROXY_RE = /\/f\/(file_[\w-]+)/;
const IMAGE_NODE_TYPES = new Set(['image', 'block-image']);
const FILE_NODE_TYPE = 'file';

interface SerializedNode {
  children?: SerializedNode[];
  fileUrl?: string;
  src?: string;
  status?: string;
  type?: string;
}

interface SerializedEditorJson {
  root?: SerializedNode;
}

/**
 * Collect the `(src | fileUrl)` URLs of every uploaded image / file node.
 * Pure JSON tree walk — no IO.
 */
export function collectAttachmentUrlsFromEditorData(json: unknown): string[] {
  const root = (json as SerializedEditorJson | undefined)?.root;
  if (!root) return [];

  const urls: string[] = [];

  const urlFor = (node: SerializedNode): string | undefined => {
    const type = node.type;
    if (type && IMAGE_NODE_TYPES.has(type)) return node.src;
    if (type === FILE_NODE_TYPE) return node.fileUrl;
    return undefined;
  };

  const visit = (node: SerializedNode | undefined): void => {
    if (!node || typeof node !== 'object') return;

    const isUploaded = node.status === undefined || node.status === 'uploaded';
    const url = isUploaded ? urlFor(node) : undefined;
    if (url) urls.push(url);

    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };

  visit(root);
  return urls;
}

/**
 * Best-effort: pull the S3 key out of a pre-signed URL's pathname. Returns
 * undefined when the URL is the proxy form (no key to extract).
 *
 * Example: `https://bucket.r2.cloudflarestorage.com/ppp/494360/abc.jpg?X-Amz-…`
 *          → `ppp/494360/abc.jpg`
 */
function extractStorageKeyFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname.replace(/^\/+/, '');
    return path || undefined;
  } catch {
    return undefined;
  }
}

export async function extractFileIdsFromEditorData(
  json: unknown,
  ctx: { db: LobeChatDatabase; userId: string; workspaceId?: string },
): Promise<string[]> {
  const urls = collectAttachmentUrlsFromEditorData(json);
  if (urls.length === 0) return [];

  const seen = new Set<string>();
  const unresolved: string[] = [];

  // Pass 1: regex on the proxy-URL form.
  for (const url of urls) {
    const match = url.match(FILE_PROXY_RE);
    if (match) {
      seen.add(match[1]);
    } else {
      unresolved.push(url);
    }
  }

  // Pass 2: look up the remaining URLs by storage key in `files`. Same bytes
  // re-uploaded by the same user produce multiple rows with identical
  // `url` + `file_hash`; dedupe per key so the agent doesn't receive the
  // same asset N times.
  if (unresolved.length > 0) {
    const keys = unresolved.map(extractStorageKeyFromUrl).filter((key): key is string => !!key);

    if (keys.length > 0) {
      const rows = await ctx.db
        .select({ id: files.id, url: files.url })
        .from(files)
        .where(and(buildWorkspaceWhere(ctx, files), inArray(files.url, keys)));

      const firstIdPerUrl = new Map<string, string>();
      for (const row of rows) {
        if (!firstIdPerUrl.has(row.url)) firstIdPerUrl.set(row.url, row.id);
      }
      for (const id of firstIdPerUrl.values()) seen.add(id);
    }
  }

  return [...seen];
}
