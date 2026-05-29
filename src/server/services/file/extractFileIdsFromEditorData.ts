import { extractMediaFromEditorState } from '@lobehub/editor/headless';
import type { SerializedEditorState } from 'lexical';

/**
 * Server-side fileId resolution for Task editor state.
 *
 * `extractMediaFromEditorState` walks the JSON for us; we just map the
 * resulting URLs back to fileIds via the proxy URL contract in
 * `src/server/routers/lambda/file.ts`:
 *
 *     getFileProxyUrl(fileId) = `${APP_URL}/f/${fileId}`
 *
 * The editor only knows URLs — the `/f/{fileId}` form is LobeHub-specific,
 * so the regex stays here.
 */
const FILE_PROXY_RE = /\/f\/(fle_[\w-]+)/;

export function extractFileIdsFromEditorData(json: unknown): string[] {
  if (!json) return [];

  const { imageList, fileList } = extractMediaFromEditorState(json as SerializedEditorState);

  const seen = new Set<string>();
  for (const { url } of imageList) {
    const match = url.match(FILE_PROXY_RE);
    if (match) seen.add(match[1]);
  }
  for (const { url } of fileList) {
    const match = url.match(FILE_PROXY_RE);
    if (match) seen.add(match[1]);
  }
  return [...seen];
}
