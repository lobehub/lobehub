import { writeFileSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { RedisKeyNamespace, resetPrefixedRedisClient } from '@/libs/redis';
import { Sitemap } from '@/server/sitemap';

dotenv.config();

const genSitemap = async () => {
  const sitemapModule = new Sitemap();
  const sitemapIndexXML = await sitemapModule.getIndex();
  const filename = path.resolve(__dirname, '../../', 'public', 'sitemap-index.xml');
  writeFileSync(filename, sitemapIndexXML);
};

const main = async () => {
  try {
    await genSitemap();
  } finally {
    console.log('[build-sitemap] Closing LobeHub Redis client');
    await resetPrefixedRedisClient(RedisKeyNamespace.LOBEHUB);
    console.log('[build-sitemap] Closed LobeHub Redis client');
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
