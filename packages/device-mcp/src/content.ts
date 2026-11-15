import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import type {
  AudioContent,
  ImageContent,
  ResourceContent,
  TextContent,
  ToolCallContent,
} from './types';

/**
 * Stores one media block a tool returned and answers the key the result keeps
 * in place of its base64 bytes. `path` is a suggested storage path
 * (`mcp/<images|audios>/<day>/<uuid>.<ext>`); a host with its own naming may
 * ignore it. Answers `undefined` when this host cannot store media right now
 * (e.g. no server credentials): the block is then replaced by a text note the
 * model can explain, instead of failing a tool call that already ran.
 */
export type McpMediaUploader = (media: {
  /** The block's bytes as the server sent them (base64, no `data:` prefix). */
  base64: string;
  buffer: Buffer;
  filename: string;
  hash: string;
  mimeType: string;
  path: string;
}) => Promise<string | undefined>;

/** Resolves a key {@link McpMediaUploader} returned to a URL the chat can load. */
export type McpMediaUrlResolver = (key: string) => Promise<string>;

const MEDIA_UPLOAD_CONFIG = {
  audio: {
    defaultExtension: 'mp3',
    defaultMimeType: 'audio/mpeg',
    pathnameSegment: 'audios',
  },
  image: {
    defaultExtension: 'png',
    defaultMimeType: 'image/png',
    pathnameSegment: 'images',
  },
} as const;

type MediaContentType = keyof typeof MEDIA_UPLOAD_CONFIG;

const PREFERRED_MIME_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'image/svg+xml': 'svg',
};

const normalizeMimeType = (mimeType: string | undefined, mediaType: MediaContentType) => {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase();
  return normalized || MEDIA_UPLOAD_CONFIG[mediaType].defaultMimeType;
};

const getMediaContentType = (mimeType: string | undefined): MediaContentType | undefined => {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase();
  if (normalized?.startsWith('image/')) return 'image';
  if (normalized?.startsWith('audio/')) return 'audio';
};

const getFileExtensionFromMimeType = (mimeType: string, mediaType: MediaContentType) => {
  const [, subtype = ''] = mimeType.split('/');
  const sanitizedSubtype = subtype
    .split('+')[0]
    .replaceAll(/[^a-z0-9]/gi, '')
    .toLowerCase();

  return (
    PREFERRED_MIME_EXTENSIONS[mimeType] ||
    sanitizedSubtype ||
    MEDIA_UPLOAD_CONFIG[mediaType].defaultExtension
  );
};

const todayShard = () => new Date().toISOString().split('T')[0];

const uploadMediaBlock = async (
  upload: McpMediaUploader,
  base64: string,
  mediaType: MediaContentType,
  mimeType: string,
) => {
  const config = MEDIA_UPLOAD_CONFIG[mediaType];
  const ext = getFileExtensionFromMimeType(mimeType, mediaType);
  const buffer = Buffer.from(base64, 'base64');
  const hash = createHash('sha256').update(buffer).digest('hex');
  const filename = `${randomUUID()}.${ext}`;
  const filePath = path.posix.join('mcp', config.pathnameSegment, todayShard(), filename);

  return upload({ base64, buffer, filename, hash, mimeType, path: filePath });
};

const mediaUnavailable = (mediaType: MediaContentType, mimeType: string): TextContent => ({
  text: `[The MCP tool returned ${mediaType === 'image' ? 'an image' : 'audio'} (${mimeType}) that this device could not upload, so it is not shown.]`,
  type: 'text',
});

/**
 * Replace the base64 bytes of every image / audio block (and media `resource`
 * blobs) with the key the uploader stored them under, so a tool result stays
 * small and the chat loads media by URL.
 */
export const uploadMediaBlocks = (
  blocks: ToolCallContent[],
  upload: McpMediaUploader,
): Promise<ToolCallContent[]> =>
  Promise.all(
    blocks.map(async (block) => {
      if (block.type === 'image' || block.type === 'audio') {
        const mediaType = block.type;
        const mimeType = normalizeMimeType(block.mimeType, mediaType);
        const data = await uploadMediaBlock(upload, block.data, mediaType, mimeType);
        if (data === undefined) return mediaUnavailable(mediaType, mimeType);

        return { ...block, data, mimeType };
      }

      if (block.type === 'resource') {
        const resourceBlock = block as ResourceContent;
        const resource = resourceBlock.resource;
        const mediaType = getMediaContentType(resource?.mimeType);

        if (!resource?.blob || !mediaType) return block;

        const mimeType = normalizeMimeType(resource.mimeType, mediaType);
        const data = await uploadMediaBlock(upload, resource.blob, mediaType, mimeType);
        if (data === undefined) return mediaUnavailable(mediaType, mimeType);
        const metadata = resourceBlock._meta ? { _meta: resourceBlock._meta } : {};

        if (mediaType === 'image') {
          return { ...metadata, data, mimeType, type: 'image' } as ImageContent;
        }

        return { ...metadata, data, mimeType, type: 'audio' } as AudioContent;
      }

      return block;
    }),
  );

/** Render processed content blocks as the markdown the model reads. */
export const contentBlocksToMarkdown = async (
  blocks: ToolCallContent[] | null | undefined,
  getHTTPURL: McpMediaUrlResolver,
) => {
  if (!blocks) return '';

  const parts = await Promise.all(
    blocks.map(async (item) => {
      switch (item.type) {
        case 'text': {
          return item.text;
        }
        case 'image': {
          const url = await getHTTPURL(item.data);
          return `![](${url})`;
        }
        case 'audio': {
          const url = await getHTTPURL(item.data);
          return `<resource type="${item.type}" url="${url}" />`;
        }
        case 'resource': {
          return `<resource type="${item.type}">${JSON.stringify(item.resource)}</resource>`;
        }
        default: {
          return '';
        }
      }
    }),
  );

  return parts.filter(Boolean).join('\n\n');
};
