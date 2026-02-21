import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import { type LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';
import { nanoid } from 'nanoid';
import sharp from 'sharp';

import { FileService } from '@/server/services/file';
import { calculateThumbnailDimensions } from '@/utils/number';
import { getYYYYmmddHHMMss } from '@/utils/time';

const log = debug('lobe-video:generation-service');
const execFileAsync = promisify(execFile);

let _ffmpegPath: string | null = null;

function getFfmpegPath(): string {
  if (_ffmpegPath) return _ffmpegPath;
  _ffmpegPath = require('ffmpeg-static') as string;
  return _ffmpegPath;
}

interface VideoMetadata {
  duration: number;
  height: number;
  width: number;
}

export interface VideoProcessResult {
  coverKey: string;
  duration: number;
  fileHash: string;
  fileSize: number;
  height: number;
  mimeType: string;
  thumbnailKey: string;
  videoKey: string;
  width: number;
}

export class VideoGenerationService {
  private fileService: FileService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.fileService = new FileService(db, userId);
  }

  /**
   * Download video, extract metadata, generate cover/thumbnail, upload all to S3
   */
  async processVideoForGeneration(videoUrl: string): Promise<VideoProcessResult> {
    log('Processing video from URL: %s', videoUrl);

    let tempVideoPath: string | null = null;
    let tempCoverPath: string | null = null;

    try {
      tempVideoPath = await this.downloadVideo(videoUrl);

      const [metadata, videoBuffer] = await Promise.all([
        this.getVideoMetadata(tempVideoPath),
        fs.readFile(tempVideoPath),
      ]);

      log('Video metadata: %O', metadata);

      const fileHash = createHash('sha256').update(videoBuffer).digest('hex');
      const fileSize = videoBuffer.length;

      // Determine MIME type from URL or default to mp4
      const ext = path.extname(new URL(videoUrl).pathname).toLowerCase();
      const mimeType = ext === '.webm' ? 'video/webm' : 'video/mp4';
      const videoExt = ext || '.mp4';

      // Generate S3 keys
      const uuid = nanoid();
      const dateTime = getYYYYmmddHHMMss(new Date());
      const generationsFolder = 'generations/videos';

      // Upload video
      const videoKey = `${generationsFolder}/${uuid}_${metadata.width}x${metadata.height}_${dateTime}_raw${videoExt}`;
      log('Uploading video to: %s', videoKey);
      await this.fileService.uploadMedia(videoKey, videoBuffer);

      // Generate cover screenshot and thumbnail
      tempCoverPath = await this.generateScreenshot(tempVideoPath, metadata.width, metadata.height);
      const coverBuffer = await fs.readFile(tempCoverPath);

      // Convert cover to webp
      const coverWebpBuffer = await sharp(coverBuffer).webp({ quality: 100 }).toBuffer();
      const coverKey = `${generationsFolder}/${uuid}_${metadata.width}x${metadata.height}_${dateTime}_cover.webp`;
      log('Uploading cover to: %s', coverKey);

      // Calculate thumbnail dimensions
      const { shouldResize, thumbnailWidth, thumbnailHeight } = calculateThumbnailDimensions(
        metadata.width,
        metadata.height,
      );

      let thumbnailKey: string;

      if (shouldResize) {
        const thumbnailBuffer = await sharp(coverBuffer)
          .resize(thumbnailWidth, thumbnailHeight, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 100 })
          .toBuffer();

        thumbnailKey = `${generationsFolder}/${uuid}_${thumbnailWidth}x${thumbnailHeight}_${dateTime}_thumb.webp`;
        log('Uploading thumbnail to: %s', thumbnailKey);

        // Upload cover and thumbnail in parallel
        await Promise.all([
          this.fileService.uploadMedia(coverKey, coverWebpBuffer),
          this.fileService.uploadMedia(thumbnailKey, thumbnailBuffer),
        ]);
      } else {
        // Cover and thumbnail are the same size, reuse the same key
        thumbnailKey = coverKey;
        await this.fileService.uploadMedia(coverKey, coverWebpBuffer);
      }

      log('Video processing completed successfully');

      return {
        coverKey,
        duration: metadata.duration,
        fileHash,
        fileSize,
        height: metadata.height,
        mimeType,
        thumbnailKey,
        videoKey,
        width: metadata.width,
      };
    } finally {
      // Clean up temp files
      if (tempVideoPath) {
        await fs.unlink(tempVideoPath).catch((err) => {
          log('Failed to cleanup temp video file: %O', err);
        });
      }
      if (tempCoverPath) {
        await fs.unlink(tempCoverPath).catch((err) => {
          log('Failed to cleanup temp cover file: %O', err);
        });
      }
    }
  }

  /** Max video file size: 500 MB */
  private static MAX_VIDEO_SIZE = 500 * 1024 * 1024;
  /** Download timeout: 5 minutes */
  private static DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

  private async downloadVideo(url: string): Promise<string> {
    const ext = path.extname(new URL(url).pathname).toLowerCase() || '.mp4';
    const tempVideoPath = path.join(os.tmpdir(), `lobe-video-${nanoid()}${ext}`);
    log('Downloading video to: %s', tempVideoPath);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(VideoGenerationService.DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    }

    // Check Content-Length header if available
    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength && contentLength > VideoGenerationService.MAX_VIDEO_SIZE) {
      throw new Error(
        `Video file too large: ${contentLength} bytes (max ${VideoGenerationService.MAX_VIDEO_SIZE} bytes)`,
      );
    }

    if (!response.body) {
      throw new Error(`Response body is empty for video URL: ${url}`);
    }

    // Track downloaded size during streaming
    let downloadedSize = 0;
    const maxSize = VideoGenerationService.MAX_VIDEO_SIZE;
    const sizeCheckTransform = new TransformStream({
      transform(chunk, controller) {
        downloadedSize += chunk.byteLength;
        if (downloadedSize > maxSize) {
          controller.error(
            new Error(`Video file too large: exceeded ${maxSize} bytes during download`),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    });

    const limitedBody = response.body.pipeThrough(sizeCheckTransform);
    await pipeline(Readable.fromWeb(limitedBody as any), createWriteStream(tempVideoPath));

    log('Video downloaded successfully (%d bytes)', downloadedSize);
    return tempVideoPath;
  }

  private async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
    const ffmpegPath = getFfmpegPath();

    // ffmpeg -i exits with code 1 when no output is specified, but stderr contains metadata
    let stderr = '';
    try {
      const result = await execFileAsync(ffmpegPath, ['-i', videoPath, '-hide_banner']);
      stderr = result.stderr;
    } catch (error: any) {
      stderr = error.stderr || '';
      // Exit code 1 is expected when no output is specified
      if (!stderr) throw error;
    }

    // Parse duration: "Duration: 00:05:30.12"
    const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    const duration = durationMatch
      ? Number.parseInt(durationMatch[1]) * 3600 +
        Number.parseInt(durationMatch[2]) * 60 +
        Number.parseFloat(durationMatch[3])
      : 0;

    // Parse video stream dimensions: "Stream #0:0...: Video: ..., 1920x1080"
    const streamMatch = stderr.match(/Stream.*Video.*?(\d{2,5})x(\d{2,5})/);
    if (!streamMatch) {
      throw new Error(`Failed to parse video dimensions from ffmpeg output:\n${stderr}`);
    }

    return {
      duration,
      height: Number.parseInt(streamMatch[2]),
      width: Number.parseInt(streamMatch[1]),
    };
  }

  /**
   * Take a screenshot at 0.1s and return the temp file path
   */
  private async generateScreenshot(
    videoPath: string,
    width: number,
    height: number,
  ): Promise<string> {
    const ffmpegPath = getFfmpegPath();
    const outputPath = path.join(os.tmpdir(), `lobe-cover-${nanoid()}.jpg`);

    log('Generating screenshot from video');

    await execFileAsync(ffmpegPath, [
      '-ss',
      '0.1',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-s',
      `${width}x${height}`,
      '-y',
      outputPath,
    ]);

    return outputPath;
  }
}
