import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import pMap from 'p-map';

import s3 from '../cdnWorkflow/s3';

interface UploadConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  keyPrefix: string;
  publicDomain: string;
  region: string;
  secretAccessKey: string;
}

export async function verifyUploadedAssets(urls: string[]) {
  if (urls.length === 0) {
    throw new Error('No mobile assets were uploaded');
  }

  const responses = await Promise.all(
    urls.map(async (url) => {
      try {
        return { response: await fetch(url, { method: 'HEAD' }), url };
      } catch (error) {
        return { error, response: undefined, url };
      }
    }),
  );
  const missing = responses.filter(({ response }) => !response?.ok);

  if (missing.length > 0) {
    throw new Error(
      `Uploaded mobile assets are not publicly reachable: ${missing
        .map(({ error, response, url }) => `${url} (${response?.status ?? String(error)})`)
        .join(', ')}`,
    );
  }
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

export async function uploadAssets(assetsDir: string, config: UploadConfig) {
  const files = collectFiles(assetsDir);
  console.log(`Found ${files.length} files to upload`);

  const client = s3.createS3Client({
    accessKeyId: config.accessKeyId,
    bucketName: config.bucket,
    endpoint: config.endpoint,
    pathPrefix: '',
    region: config.region,
    secretAccessKey: config.secretAccessKey,
  });

  const results = await pMap(
    files,
    async (filePath) => {
      const relativePath = filePath.slice(assetsDir.length + 1);
      const key = `${config.keyPrefix}/assets/${relativePath}`;
      const buffer = readFileSync(filePath);
      const fileName = basename(filePath);
      const ext = extname(filePath);

      console.log(`Uploading ${key}...`);

      const result = await s3.createUploadTask({
        acl: 'public-read',
        bucketName: config.bucket,
        client,
        item: { buffer, extname: ext, fileName },
        path: key,
        urlPrefix: config.publicDomain,
      });

      console.log(`Uploaded ${key} -> ${result.url}`);
      return result;
    },
    { concurrency: 10 },
  );

  await verifyUploadedAssets(results.map(({ url }) => url));
  console.log(`Successfully uploaded ${results.length} files`);
  return results;
}
