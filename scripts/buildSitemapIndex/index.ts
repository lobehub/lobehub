import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenv from 'dotenv';

import { Sitemap } from '@/server/sitemap';

dotenv.config();

const genSitemap = async () => {
  const sitemapModule = new Sitemap();
  const sitemapIndexXML = await sitemapModule.getIndex();
  const filename = resolve(__dirname, '../../', 'public', 'sitemap-index.xml');
  writeFileSync(filename, sitemapIndexXML);
};

genSitemap().catch(console.error);
