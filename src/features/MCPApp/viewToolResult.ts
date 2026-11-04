import { isDesktop } from '@lobechat/const';
import type { CallToolResult } from '@modelcontextprotocol/client';

import { ensureElectronIpc } from '@/utils/electron/ipc';

type ContentBlock = CallToolResult['content'][number];

const isStoredMediaRef = (data: string) =>
  /^https?:\/\//i.test(data) || data.startsWith('desktop:/');

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked: spreading a large array into fromCharCode overflows the stack
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/** Read media the chat stored (an uploaded URL, or a desktop file) back as base64. */
const readStoredMedia = async (ref: string): Promise<string> => {
  if (ref.startsWith('desktop:/')) {
    if (!isDesktop) throw new Error('Desktop media can only be read on the desktop');
    return ensureElectronIpc().mcp.readStoredMcpMedia(ref);
  }

  const response = await fetch(ref, { credentials: 'include' });
  if (!response.ok) throw new Error(`Media request failed with ${response.status}`);
  return toBase64(await response.arrayBuffer());
};

/**
 * The tool result as MCP defines it, for the view the result renders with.
 * The chat stores a result's image and audio as uploaded URLs or desktop
 * files, while a view decodes their `data` as base64, so those blocks are read
 * back. A block that can't be read is left out rather than handed over broken.
 */
export const restoreMediaForView = async (result: CallToolResult): Promise<CallToolResult> => {
  const content = await Promise.all(
    result.content.map(async (block): Promise<ContentBlock | undefined> => {
      if ((block.type !== 'image' && block.type !== 'audio') || !isStoredMediaRef(block.data)) {
        return block;
      }

      try {
        return { ...block, data: await readStoredMedia(block.data) };
      } catch (error) {
        console.warn('[MCPApp] could not restore a media block for the view:', error);
        return;
      }
    }),
  );

  return { ...result, content: content.filter((block) => !!block) };
};
