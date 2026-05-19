import { imageUrlToBase64 } from '@lobechat/utils/imageToBase64';
import { parseDataUri } from '@lobechat/utils/uriParser';
import { isDesktopLocalStaticServerUrl } from '@lobechat/utils/url';

import type { VisualFileItem } from '../../visualMedia';

interface ResolveClientVisualMediaPayloadItemsParams {
  selectedRefs: VisualFileItem[];
  selectedUrls: VisualFileItem[];
}

const VISUAL_MEDIA_MIME_TYPE_PREFIXES = {
  image: 'image/',
  video: 'video/',
} as const satisfies Record<VisualFileItem['type'], string>;

const assertExpectedVisualMediaMimeType = (item: VisualFileItem, mimeType: string) => {
  const expectedPrefix = VISUAL_MEDIA_MIME_TYPE_PREFIXES[item.type];
  const normalizedMimeType = mimeType.trim().toLowerCase();

  if (normalizedMimeType.startsWith(expectedPrefix)) return;

  throw new TypeError(
    `Unable to read ${item.type} attachment "${item.name}": expected ${expectedPrefix}* MIME type, received ${normalizedMimeType || 'unknown'}.`,
  );
};

/**
 * Desktop attachments are exposed through a 127.0.0.1 static file server.
 * Convert those URLs in the client before sending a remote visual request;
 * otherwise the server sees its own localhost and SSRF protection blocks it.
 */
export const resolveClientVisualMediaUris = async (
  items: VisualFileItem[],
): Promise<VisualFileItem[]> =>
  Promise.all(
    items.map(async (item) => {
      const { type } = parseDataUri(item.uri);

      if (type !== 'url' || !isDesktopLocalStaticServerUrl(item.uri)) return item;

      const { base64, mimeType } = await imageUrlToBase64(item.uri);
      assertExpectedVisualMediaMimeType(item, mimeType);

      return {
        ...item,
        uri: `data:${mimeType};base64,${base64}`,
      };
    }),
  );

export const resolveClientVisualMediaPayloadItems = async ({
  selectedRefs,
  selectedUrls,
}: ResolveClientVisualMediaPayloadItemsParams): Promise<VisualFileItem[]> => [
  ...(await resolveClientVisualMediaUris(selectedRefs)),
  ...selectedUrls,
];
