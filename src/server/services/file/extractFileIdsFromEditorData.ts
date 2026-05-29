/**
 * Walks a serialized Lexical editor state and collects the fileIds referenced
 * by image / file nodes, via the proxy URL contract from
 * `src/server/routers/lambda/file.ts`:
 *
 *     getFileProxyUrl(fileId) = `${APP_URL}/f/${fileId}`
 *
 * Pure JSON function — no editor instance, no IO. Safe to run server-side.
 *
 * NOTE on @lobehub/editor's `extractMediaFromEditorState`:
 * we don't use it directly because it only emits nodes with
 * `status === 'uploaded'`. Real-world editor_data — including data created
 * before status tracking landed and data inserted via the cloud upload path —
 * frequently omits the `status` field, so the strict filter would silently
 * drop everything. We walk the tree ourselves so a missing `status` is
 * treated as "uploaded" for backwards compatibility.
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

export function extractFileIdsFromEditorData(json: unknown): string[] {
  const root = (json as SerializedEditorJson | undefined)?.root;
  if (!root) return [];

  const seen = new Set<string>();

  const urlFor = (node: SerializedNode): string | undefined => {
    const type = node.type;
    if (type && IMAGE_NODE_TYPES.has(type)) return node.src;
    if (type === FILE_NODE_TYPE) return node.fileUrl;
    return undefined;
  };

  const visit = (node: SerializedNode | undefined): void => {
    if (!node || typeof node !== 'object') return;

    // Permissive: treat absent `status` as uploaded — historical data and the
    // cloud upload path both insert nodes without setting it.
    const isUploaded = node.status === undefined || node.status === 'uploaded';
    const url = isUploaded ? urlFor(node) : undefined;

    if (url) {
      const match = url.match(FILE_PROXY_RE);
      if (match) seen.add(match[1]);
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };

  visit(root);
  return [...seen];
}
