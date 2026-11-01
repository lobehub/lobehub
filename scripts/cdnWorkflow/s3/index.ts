import type { PutObjectCommandOutput, S3ClientConfig } from '@aws-sdk/client-s3';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { ImgInfo, S3UserConfig, UploadResult } from './types';
import { extractInfo } from './utils';

async function getFileURL(
  opts: createUploadTaskOpts,
  eTag: string,
  versionId: string,
): Promise<string> {
  const signedUrl = await getSignedUrl(
    opts.client,
    new GetObjectCommand({
      Bucket: opts.bucketName,
      IfMatch: eTag,
      Key: opts.path,
      VersionId: versionId,
    }),
    { expiresIn: 3600 },
  );
  const urlObject = new URL(signedUrl);
  urlObject.search = '';
  return urlObject.href;
}

function createS3Client(opts: S3UserConfig): S3Client {
  const clientOptions: S3ClientConfig = {
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },

    endpoint: opts.endpoint || undefined,
    forcePathStyle: opts.pathStyleAccess,
    region: opts.region || 'auto',
  };

  const client = new S3Client(clientOptions);
  return client;
}

interface createUploadTaskOpts {
  acl: string;
  bucketName: string;
  client: S3Client;
  item: ImgInfo;
  path: string;
  urlPrefix?: string;
}

async function createUploadTask(opts: createUploadTaskOpts): Promise<UploadResult> {
  if (!opts.item.buffer) {
    throw new Error('undefined image');
  }

  const { body, contentType, contentEncoding } = (await extractInfo(opts.item)) as any;

  const command = new PutObjectCommand({
    ACL: opts.acl as any,
    Body: body,
    Bucket: opts.bucketName,
    ContentEncoding: contentEncoding,
    ContentType: contentType,
    Key: opts.path,
  });

  const output: PutObjectCommandOutput = await opts.client.send(command);

  const url = opts.urlPrefix
    ? `${opts.urlPrefix}/${opts.path}`
    : await getFileURL(opts, output.ETag as string, output.VersionId as string);

  return {
    eTag: output.ETag,
    imgURL: url,
    key: opts.path,
    url,
    versionId: output.VersionId,
  };
}

export default {
  createS3Client,
  createUploadTask,
};
