import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  paginateListParts,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import mime from 'mime';
import { z } from 'zod';

import { fileEnv } from '@/envs/file';
import { YEAR } from '@/utils/units';

export const fileSchema = z.object({
  Key: z.string(),
  LastModified: z.date(),
  Size: z.number(),
});

export const listFileSchema = z.array(fileSchema);

export type FileType = z.infer<typeof fileSchema>;

const DEFAULT_S3_REGION = 'us-east-1';
const PUBLIC_READ_ACL_HEADER = 'public-read';
// S3 DeleteObjects rejects more than 1000 keys per request.
const DELETE_OBJECTS_MAX_KEYS = 1000;

const encodeContentDispositionFilename = (fileName: string) =>
  encodeURIComponent(fileName || 'download').replaceAll(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface PreSignedUpload {
  headers?: Record<string, string>;
  url: string;
}

export class S3 {
  /** Sends requests from this server, through the internal endpoint when one is set. */
  private readonly client: S3Client;

  /** Signs URLs that browsers and model providers open, so it keeps the public endpoint. */
  private readonly presignClient: S3Client;

  private readonly bucket: string;

  private readonly setAcl: boolean;

  constructor(
    accessKeyId: string | undefined,
    secretAccessKey: string | undefined,
    endpoint: string | undefined,
    options?: {
      bucket?: string;
      forcePathStyle?: boolean;
      /** Endpoint this server reaches S3 through, when `endpoint` is only reachable from outside. */
      internalEndpoint?: string;
      region?: string;
      setAcl?: boolean;
    },
  ) {
    if (!accessKeyId || !secretAccessKey || !endpoint)
      throw new Error('S3 environment variables are not set completely, please check your env');
    if (!options?.bucket) throw new Error('S3 bucket is not set, please check your env');

    this.bucket = options?.bucket;
    this.setAcl = options?.setAcl || false;

    const createClient = (clientEndpoint: string) =>
      new S3Client({
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        endpoint: clientEndpoint,
        forcePathStyle: options?.forcePathStyle,
        region: options?.region || DEFAULT_S3_REGION,
        // refs: https://github.com/lobehub/lobe-chat/pull/5479
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });

    const internalEndpoint = options?.internalEndpoint;
    this.presignClient = createClient(endpoint);
    this.client =
      internalEndpoint && internalEndpoint !== endpoint
        ? createClient(internalEndpoint)
        : this.presignClient;
  }

  public async deleteFile(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return this.client.send(command);
  }

  public async deleteFiles(keys: string[]) {
    const batches = [];
    for (let i = 0; i < keys.length; i += DELETE_OBJECTS_MAX_KEYS) {
      batches.push(keys.slice(i, i + DELETE_OBJECTS_MAX_KEYS));
    }
    if (batches.length === 0) batches.push([]);

    const results = [];
    for (const batch of batches) {
      const command = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: batch.map((key) => ({ Key: key })) },
      });
      results.push(await this.client.send(command));
    }

    return results.at(-1)!;
  }

  public async getFileContent(key: string, byteLength?: number): Promise<string> {
    const boundedLength = byteLength ? Math.max(1, Math.floor(byteLength)) : undefined;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(boundedLength ? { Range: `bytes=0-${boundedLength - 1}` } : {}),
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`No body in response with ${key}`);
    }

    return response.Body.transformToString();
  }

  public async getFileByteArray(key: string): Promise<Uint8Array> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`No body in response with ${key}`);
    }

    return response.Body.transformToByteArray();
  }

  /**
   * Get file metadata from S3 using HeadObject
   * This is used to verify actual file size from S3 instead of trusting client-provided values
   */
  public async getFileMetadata(
    key: string,
  ): Promise<{ contentLength: number; contentType?: string }> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    return {
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType,
    };
  }

  public async createPreSignedUrl(key: string, contentLength?: number): Promise<string> {
    const upload = await this.createPreSignedUpload(key, contentLength);
    return upload.url;
  }

  public async createPreSignedUpload(
    key: string,
    contentLength?: number,
  ): Promise<PreSignedUpload> {
    const command = new PutObjectCommand({
      ACL: this.setAcl ? PUBLIC_READ_ACL_HEADER : undefined,
      Bucket: this.bucket,
      ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
      Key: key,
    });

    const url = await getSignedUrl(this.presignClient, command, { expiresIn: 3600 });

    return {
      headers: this.setAcl ? { 'x-amz-acl': PUBLIC_READ_ACL_HEADER } : undefined,
      url,
    };
  }

  public async createMultipartUpload(key: string, contentType?: string): Promise<string> {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        ACL: this.setAcl ? PUBLIC_READ_ACL_HEADER : undefined,
        Bucket: this.bucket,
        ContentType: contentType || undefined,
        Key: key,
      }),
    );

    if (!response.UploadId) throw new Error(`S3 did not return an upload id for ${key}`);

    return response.UploadId;
  }

  public async createPreSignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    contentLength?: number,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
      Key: key,
      PartNumber: partNumber,
      UploadId: uploadId,
    });

    return getSignedUrl(this.presignClient, command, { expiresIn: 3600 });
  }

  public async completeMultipartUpload(
    key: string,
    uploadId: string,
    expectedPartCount: number,
    uploadedParts?: Array<{ ETag: string; PartNumber: number }>,
    expectedFile?: { partSize: number; size: number },
  ) {
    const parts: Array<{ ETag: string; PartNumber: number; Size?: number }> =
      uploadedParts && !expectedFile ? [...uploadedParts] : [];

    if (!uploadedParts || expectedFile) {
      for await (const page of paginateListParts(
        { client: this.client },
        { Bucket: this.bucket, Key: key, UploadId: uploadId },
      )) {
        for (const part of page.Parts ?? []) {
          if (!part.ETag || !part.PartNumber) continue;
          parts.push({ ETag: part.ETag, PartNumber: part.PartNumber, Size: part.Size });
        }
      }
    }

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    const hasAllParts =
      parts.length === expectedPartCount &&
      parts.every((part, index) => part.PartNumber === index + 1);

    if (!hasAllParts) {
      throw new Error(
        `S3 multipart upload ${uploadId} has ${parts.length}/${expectedPartCount} parts`,
      );
    }

    if (expectedFile) {
      const hasExpectedSizes = parts.every((part, index) => {
        const expectedSize =
          index === expectedPartCount - 1
            ? expectedFile.size - expectedFile.partSize * (expectedPartCount - 1)
            : expectedFile.partSize;
        return part.Size === expectedSize;
      });

      if (!hasExpectedSizes) {
        throw new Error(`S3 multipart upload ${uploadId} has an unexpected part size`);
      }
    }

    return this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        MultipartUpload: {
          Parts: parts.map(({ ETag, PartNumber }) => ({ ETag, PartNumber })),
        },
        UploadId: uploadId,
      }),
    );
  }

  public async abortMultipartUpload(key: string, uploadId: string) {
    return this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  public async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.presignClient, command, {
      expiresIn: expiresIn ?? fileEnv.S3_PREVIEW_URL_EXPIRE_IN,
    });
  }

  public async createPreSignedUrlForDownload(
    key: string,
    fileName: string,
    expiresIn?: number,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeContentDispositionFilename(fileName)}`,
    });

    return getSignedUrl(this.presignClient, command, {
      expiresIn: expiresIn ?? fileEnv.S3_PREVIEW_URL_EXPIRE_IN,
    });
  }

  /**
   * Upload buffer with specified content type
   */
  public async uploadBuffer(
    path: string,
    buffer: Buffer,
    contentType?: string,
    cacheControl?: string,
    /**
     * `abortSignal` cancels an upload whose result the caller no longer wants
     * written. `ifMatch` makes the write conditional on the stored object still
     * having that ETag, so a caller holding a cached copy cannot overwrite a
     * newer one; the store answers 412 instead.
     */
    options?: { abortSignal?: AbortSignal; ifMatch?: string },
  ) {
    const command = new PutObjectCommand({
      ACL: this.setAcl ? 'public-read' : undefined,
      Body: buffer,
      Bucket: this.bucket,
      CacheControl: cacheControl,
      ContentType: contentType,
      IfMatch: options?.ifMatch,
      Key: path,
    });

    return this.client.send(command, { abortSignal: options?.abortSignal });
  }

  public async uploadContent(path: string, content: string) {
    const command = new PutObjectCommand({
      ACL: this.setAcl ? 'public-read' : undefined,
      Body: content,
      Bucket: this.bucket,
      Key: path,
    });

    return this.client.send(command);
  }

  /**
   * Upload media file (images only) with long-term cache
   */
  public async uploadMedia(key: string, buffer: Buffer) {
    const contentType = mime.getType(key) || 'application/octet-stream';
    const command = new PutObjectCommand({
      ACL: this.setAcl ? 'public-read' : undefined,
      Body: buffer,
      Bucket: this.bucket,
      CacheControl: `public, max-age=${YEAR}`,
      ContentType: contentType,
      Key: key,
    });

    await this.client.send(command);
  }
}

export class FileS3 extends S3 {
  constructor() {
    super(fileEnv.S3_ACCESS_KEY_ID, fileEnv.S3_SECRET_ACCESS_KEY, fileEnv.S3_ENDPOINT, {
      bucket: fileEnv.S3_BUCKET,
      forcePathStyle: fileEnv.S3_ENABLE_PATH_STYLE,
      internalEndpoint: fileEnv.S3_INTERNAL_ENDPOINT,
      region: fileEnv.S3_REGION,
      setAcl: fileEnv.S3_SET_ACL,
    });
  }
}
