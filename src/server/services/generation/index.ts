import { LobeChatDatabase } from '@lobechat/database';
import { parseDataUri } from '@lobechat/model-runtime';
import debug from 'debug';
import { sha256 } from 'js-sha256';
import mime from 'mime';
import { IMAGE_GENERATION_CONFIG } from 'model-bank';
import { nanoid } from 'nanoid';
import sharp from 'sharp';

import { FileService } from '@/server/services/file';
import { calculateThumbnailDimensions } from '@/utils/number';
import { getYYYYmmddHHMMss } from '@/utils/time';
import { inferFileExtensionFromImageUrl } from '@/utils/url';

const log = debug('lobe-image:generation-service');

/**
 * Fetch image buffer and MIME type from URL or base64 data
 * @param url - Image URL or base64 data URI
 * @param fetchHeaders - Optional headers for authentication
 * @returns Object containing buffer and MIME type
 */
export async function fetchImageFromUrl(
  url: string,
  fetchHeaders?: Record<string, string>,
): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  if (url.startsWith('data:')) {
    const { base64, mimeType, type } = parseDataUri(url);

    if (type !== 'base64' || !base64 || !mimeType) {
      throw new Error(`Invalid data URI format: ${url}`);
    }

    try {
      const buffer = Buffer.from(base64, 'base64');
      return { buffer, mimeType };
    } catch (error) {
      throw new Error(
        `Failed to decode base64 data: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    const response = await fetch(url, { headers: fetchHeaders });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch image from ${url}: ${response.status} ${response.statusText}`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || 'application/octet-stream';
    return { buffer, mimeType };
  }
}

interface ImageForGeneration {
  buffer: Buffer;
  extension: string;
  hash: string;
  height: number;
  mime: string;
  size: number;
  width: number;
}

/**
 * 图片生成服务
 * 负责处理AI生成图片的转换、上传和封面创建
 */
export class GenerationService {
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.fileService = new FileService(db, userId);
  }

  /**
   * Generate width 512px image as thumbnail when width > 512, end with _512.webp
   */
  async transformImageForGeneration(
    url: string,
    fetchHeaders?: Record<string, string>,
  ): Promise<{
    image: ImageForGeneration;
    thumbnailImage: ImageForGeneration;
  }> {
    log('Starting image transformation for:', url.startsWith('data:') ? 'base64 data' : url);

    // Fetch image buffer and MIME type using utility function
    const { buffer: originalImageBuffer, mimeType: originalMimeType } = await fetchImageFromUrl(
      url,
      fetchHeaders,
    );

    // Calculate hash for original image
    const originalHash = sha256(originalImageBuffer);

    const sharpInstance = sharp(originalImageBuffer);
    const { format, width, height } = await sharpInstance.metadata();
    log('Image metadata:', { format, height, width });

    if (!width || !height) {
      throw new Error(`Invalid image format: ${format}, url: ${url}`);
    }

    const {
      shouldResize: shouldResizeBySize,
      thumbnailWidth,
      thumbnailHeight,
    } = calculateThumbnailDimensions(width, height);
    const shouldResize = shouldResizeBySize || format !== 'webp';

    log('Thumbnail processing decision:', {
      format,
      shouldResize,
      shouldResizeBySize,
      thumbnailHeight,
      thumbnailWidth,
    });

    const thumbnailBuffer = shouldResize
      ? await sharpInstance.resize(thumbnailWidth, thumbnailHeight).webp().toBuffer()
      : originalImageBuffer;

    // Calculate hash for thumbnail
    const thumbnailHash = sha256(thumbnailBuffer);

    log('Image transformation completed successfully');

    // Determine extension using url utility
    let extension: string;
    if (url.startsWith('data:')) {
      const mimeExtension = mime.getExtension(originalMimeType);
      if (!mimeExtension) {
        throw new Error(`Unable to determine file extension for MIME type: ${originalMimeType}`);
      }
      extension = mimeExtension;
    } else {
      // Try to get extension from URL path first
      extension = inferFileExtensionFromImageUrl(url);

      // For ComfyUI URLs, check filename in query parameters
      if (!extension && url.includes('filename=')) {
        try {
          const urlObj = new URL(url);
          const filename = urlObj.searchParams.get('filename');
          if (filename) {
            extension = inferFileExtensionFromImageUrl(filename);
          }
        } catch {
          // Ignore URL parsing errors
        }
      }

      // If still no extension, try to get from MIME type
      if (!extension && originalMimeType && originalMimeType !== 'application/octet-stream') {
        const mimeExtension = mime.getExtension(originalMimeType);
        if (mimeExtension) {
          extension = mimeExtension;
        }
      }

      if (!extension) {
        throw new Error(`Unable to determine file extension from URL: ${url}`);
      }
    }

    return {
      image: {
        buffer: originalImageBuffer,
        extension,
        hash: originalHash,
        height,
        mime: originalMimeType,
        size: originalImageBuffer.length,
        width,
      },
      thumbnailImage: {
        buffer: thumbnailBuffer,
        extension: 'webp',
        hash: thumbnailHash,
        height: thumbnailHeight,
        mime: 'image/webp',
        size: thumbnailBuffer.length,
        width: thumbnailWidth,
      },
    };
  }

  async uploadImageForGeneration(image: ImageForGeneration, thumbnail: ImageForGeneration) {
    log('Starting image upload for generation');

    const generationImagesFolder = 'generations/images';
    const uuid = nanoid();
    const dateTime = getYYYYmmddHHMMss(new Date());
    const imageKey = `${generationImagesFolder}/${uuid}_${image.width}x${image.height}_${dateTime}_raw.${image.extension}`;
    const thumbnailKey = `${generationImagesFolder}/${uuid}_${thumbnail.width}x${thumbnail.height}_${dateTime}_thumb.${thumbnail.extension}`;

    log('Generated paths:', { imagePath: imageKey, thumbnailPath: thumbnailKey });

    // Check if image and thumbnail buffers are identical
    const isIdenticalBuffer = image.buffer.equals(thumbnail.buffer);
    log('Buffer comparison:', {
      imageSize: image.buffer.length,
      isIdenticalBuffer,
      thumbnailSize: thumbnail.buffer.length,
    });

    if (isIdenticalBuffer) {
      log('Buffers are identical, uploading single image');
      // If buffers are identical, only upload once
      const result = await this.fileService.uploadMedia(imageKey, image.buffer);
      log('Single image uploaded successfully:', result.key);
      // Use the same key for both image and thumbnail
      return {
        imageUrl: result.key,
        thumbnailImageUrl: result.key,
      };
    } else {
      log('Buffers are different, uploading both images');
      // If buffers are different, upload both
      const [imageResult, thumbnailResult] = await Promise.all([
        this.fileService.uploadMedia(imageKey, image.buffer),
        this.fileService.uploadMedia(thumbnailKey, thumbnail.buffer),
      ]);

      log('Both images uploaded successfully:', {
        imageUrl: imageResult.key,
        thumbnailImageUrl: thumbnailResult.key,
      });

      return {
        imageUrl: imageResult.key,
        thumbnailImageUrl: thumbnailResult.key,
      };
    }
  }

  /**
   * Create a cover image from a given URL and upload
   * @param coverUrl - The source image URL (can be base64 or HTTP URL)
   * @returns The key of the uploaded cover image
   */
  async createCoverFromUrl(coverUrl: string): Promise<string> {
    log('Creating cover image from URL:', coverUrl.startsWith('data:') ? 'base64 data' : coverUrl);

    // Fetch image buffer using utility function
    const { buffer: originalImageBuffer } = await fetchImageFromUrl(coverUrl);

    // Get image metadata to calculate proper cover dimensions
    const sharpInstance = sharp(originalImageBuffer);
    const { width, height } = await sharpInstance.metadata();

    if (!width || !height) {
      throw new Error('Invalid image format for cover creation');
    }

    // Calculate cover dimensions maintaining aspect ratio with configurable max size
    const { thumbnailWidth, thumbnailHeight } = calculateThumbnailDimensions(
      width,
      height,
      IMAGE_GENERATION_CONFIG.COVER_MAX_SIZE,
    );

    log('Processing cover image with dimensions:', {
      cover: { height: thumbnailHeight, width: thumbnailWidth },
      original: { height, width },
    });

    const coverBuffer = await sharpInstance
      .resize(thumbnailWidth, thumbnailHeight)
      .webp()
      .toBuffer();

    log('Cover image processed, final size:', coverBuffer.length);

    // Upload using FileService
    const coverFolder = 'generations/covers';
    const uuid = nanoid();
    const dateTime = getYYYYmmddHHMMss(new Date());
    const coverKey = `${coverFolder}/${uuid}_${thumbnailWidth}x${thumbnailHeight}_${dateTime}_cover.webp`;

    log('Uploading cover image:', coverKey);
    const result = await this.fileService.uploadMedia(coverKey, coverBuffer);

    log('Cover image uploaded successfully:', result.key);
    return result.key;
  }
}
