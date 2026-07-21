#!/usr/bin/env node

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;

if (!endpoint || !bucket) {
  console.error('S3_ENDPOINT and S3_BUCKET are required.');
  process.exit(1);
}

const client = new S3Client({
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || 'S3RVER',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'S3RVER',
  },
  endpoint,
  forcePathStyle: process.env.S3_ENABLE_PATH_STYLE !== '0',
  region: process.env.S3_REGION || 'us-east-1',
});

const key = `.agent-testing/preflight-${process.pid}-${Date.now()}.txt`;
const expected = `agent-testing-s3-${Date.now()}`;

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  await client.send(new PutObjectCommand({ Body: expected, Bucket: bucket, Key: key }));
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const actual = await result.Body?.transformToString();
  if (actual !== expected) {
    throw new Error(`round-trip content mismatch: expected ${expected}, received ${actual}`);
  }
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log(`S3 read/write/delete passed: ${endpoint}/${bucket}`);
} catch (error) {
  console.error(`S3 preflight failed for ${endpoint}/${bucket}:`, error);
  process.exit(1);
} finally {
  client.destroy();
}
