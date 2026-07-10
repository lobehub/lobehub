import debug from 'debug';
import mime from 'mime';
import pMap from 'p-map';

import { fileEnv } from '@/envs/file';
import {
  type AudioContent,
  type ImageContent,
  type ResourceContent,
  type ToolCallContent,
} from '@/libs/mcp';
import { type FileService } from '@/server/services/file';
import { nanoid } from '@/utils/uuid';

const log = debug('lobe-mcp:content-processor');

export type ProcessContentBlocksFn = (blocks: ToolCallContent[]) => Promise<ToolCallContent[]>;

const MEDIA_UPLOAD_CONFIG = {
  audio: {
    defaultExtension: 'mp3',
    defaultMimeType: 'audio/mpeg',
    pathnameSegment: 'audio',
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
  return (
    PREFERRED_MIME_EXTENSIONS[mimeType] ||
    mime.getExtension(mimeType) ||
    MEDIA_UPLOAD_CONFIG[mediaType].defaultExtension
  );
};

const uploadMcpMedia = async ({
  base64Data,
  fileService,
  mediaType,
  mimeType,
  today,
}: {
  base64Data: string;
  fileService: FileService;
  mediaType: MediaContentType;
  mimeType: string;
  today: string;
}) => {
  const config = MEDIA_UPLOAD_CONFIG[mediaType];
  const fileExtension = getFileExtensionFromMimeType(mimeType, mediaType);
  const pathname = `${fileEnv.NEXT_PUBLIC_S3_FILE_PATH}/mcp/${config.pathnameSegment}/${today}/${nanoid()}.${fileExtension}`;

  return fileService.uploadBase64(base64Data, pathname, { fileType: mimeType });
};

/**
 * Process content blocks returned by MCP
 * - Upload images/audio to storage and replace data with proxy URL
 * - Keep other types of blocks unchanged
 */
export const processContentBlocks = async (
  blocks: ToolCallContent[],
  fileService: FileService,
): Promise<ToolCallContent[]> => {
  // Use date-based sharding for privacy compliance (GDPR, CCPA)
  const today = new Date().toISOString().split('T')[0]; // e.g., "2025-11-08"

  return pMap(blocks, async (block) => {
    if (block.type === 'image') {
      const imageBlock = block as ImageContent;
      const mimeType = normalizeMimeType(imageBlock.mimeType, 'image');
      const { url } = await uploadMcpMedia({
        base64Data: imageBlock.data,
        fileService,
        mediaType: 'image',
        mimeType,
        today,
      });

      log(`Image uploaded, proxy URL: ${url}`);

      return { ...block, data: url, mimeType };
    }

    if (block.type === 'audio') {
      const audioBlock = block as AudioContent;
      const mimeType = normalizeMimeType(audioBlock.mimeType, 'audio');
      const { url } = await uploadMcpMedia({
        base64Data: audioBlock.data,
        fileService,
        mediaType: 'audio',
        mimeType,
        today,
      });

      log(`Audio uploaded, proxy URL: ${url}`);

      return { ...block, data: url, mimeType };
    }

    // Handle resource blocks that contain binary image/audio data
    if (block.type === 'resource') {
      const resourceBlock = block as ResourceContent;
      const resource = resourceBlock.resource;
      const mediaType = getMediaContentType(resource?.mimeType);

      if (!resource?.blob || !mediaType) return block;

      const mimeType = normalizeMimeType(resource.mimeType, mediaType);
      const { url } = await uploadMcpMedia({
        base64Data: resource.blob,
        fileService,
        mediaType,
        mimeType,
        today,
      });

      log(`Resource ${mediaType} uploaded (${resource.uri}), proxy URL: ${url}`);

      // Convert to native media content so downstream renderers/model adapters handle it visually.
      const metadata = resourceBlock._meta ? { _meta: resourceBlock._meta } : {};
      if (mediaType === 'image') {
        return { ...metadata, data: url, mimeType, type: 'image' } as ImageContent;
      }

      return { ...metadata, data: url, mimeType, type: 'audio' } as AudioContent;
    }

    return block;
  });
};

/**
 * Convert content blocks to string
 * - text: Extract text field
 * - image/audio: Extract data field (usually the proxy URL after upload)
 * - others: Return empty string
 */
export const contentBlocksToString = (blocks: ToolCallContent[] | null | undefined): string => {
  if (!blocks) return '';

  return blocks
    .map((item) => {
      switch (item.type) {
        case 'text': {
          return item.text;
        }

        case 'image': {
          return `![](${item.data})`;
        }

        case 'audio': {
          return `<resource type="${item.type}" url="${item.data}" />`;
        }

        case 'resource': {
          return `<resource type="${item.type}">${JSON.stringify(item.resource)}</resource>`;
        }

        default: {
          return '';
        }
      }
    })
    .filter(Boolean)
    .join('\n\n');
};
