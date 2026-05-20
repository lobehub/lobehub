import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { consola } from 'consola';
import { writeJSONSync } from 'fs-extra';
import matter from 'gray-matter';
import pMap from 'p-map';

import { uploader } from './uploader';
import {
  changelogIndex,
  changelogIndexPath,
  extractHttpsLinks,
  fetchImageAsFile,
  mergeAndDeduplicateArrays,
  posts,
  root,
} from './utils';

// Define constants
const GITHUB_CDN = 'https://github.com/lobehub/lobe-chat/assets/';
const CHECK_CDN = [
  'https://cdn.nlark.com/yuque/0/',
  'https://s.imtccdn.com/',
  'https://oss.home.imtc.top/',
  'https://www.anthropic.com/_next/image',
  'https://miro.medium.com/v2/',
  'https://images.unsplash.com/',
  'https://github.com/user-attachments/assets',
  'https://i.imgur.com/',
  'https://file.rene.wang',
];

const CACHE_FILE = resolve(root, 'docs', '.cdn.cache.json');

class ImageCDNUploader {
  private cache: { [link: string]: string } = {};

  constructor() {
    this.loadCache();
  }

  // Load cache data from file
  private loadCache() {
    try {
      this.cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    } catch (error) {
      consola.error('Failed to load cache', error);
    }
  }

  // Write cache data to file
  private writeCache() {
    try {
      writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      consola.error('Failed to write cache', error);
    }
  }

  // Collect all image links
  private collectImageLinks(): string[] {
    const links: string[][] = posts.map((post) => {
      const mdx = readFileSync(post, 'utf8');
      const { content, data } = matter(mdx);
      const inlineLinks: string[] = extractHttpsLinks(content);

      // Add image links from specific fields
      if (data?.image) inlineLinks.push(data.image);
      if (data?.seo?.image) inlineLinks.push(data.seo.image);

      // Filter out valid CDN links
      return inlineLinks.filter(
        (link) =>
          (link.startsWith(GITHUB_CDN) || CHECK_CDN.some((cdn) => link.startsWith(cdn))) &&
          !this.cache[link],
      );
    });

    const communityLinks = changelogIndex.community
      .map((post) => post.image)
      .filter(
        (link) =>
          link &&
          (link.startsWith(GITHUB_CDN) || CHECK_CDN.some((cdn) => link.startsWith(cdn))) &&
          !this.cache[link],
      ) as string[];

    const cloudLinks = changelogIndex.cloud
      .map((post) => post.image)
      .filter(
        (link) =>
          link &&
          (link.startsWith(GITHUB_CDN) || CHECK_CDN.some((cdn) => link.startsWith(cdn))) &&
          !this.cache[link],
      ) as string[];

    // Merge and deduplicate link arrays
    return mergeAndDeduplicateArrays(links.flat().concat(communityLinks, cloudLinks));
  }

  // Upload images to CDN
  private async uploadImagesToCDN(links: string[]) {
    const cdnLinks: { [link: string]: string } = {};

    await pMap(links, async (link) => {
      consola.start('Uploading image to CDN', link);
      const file = await fetchImageAsFile(link, 1600);

      if (!file) {
        consola.error('Failed to fetch image as file', link);
        return;
      }

      const cdnUrl = await this.uploadFileToCDN(file, link);
      if (cdnUrl) {
        consola.success(link, '>>>', cdnUrl);
        cdnLinks[link] = cdnUrl.replaceAll(process.env.DOC_S3_PUBLIC_DOMAIN || '', '');
      }
    });

    // Update cache
    this.cache = { ...this.cache, ...cdnLinks };
    this.writeCache();
  }

  // Handle file upload based on CDN type
  private async uploadFileToCDN(file: File, link: string): Promise<string | undefined> {
    if (link.startsWith(GITHUB_CDN)) {
      const filename = link.replaceAll(GITHUB_CDN, '');
      return uploader(file, filename);
    } else if (CHECK_CDN.some((cdn) => link.startsWith(cdn))) {
      const buffer = await file.arrayBuffer();
      const hash = createHash('md5').update(Buffer.from(buffer)).digest('hex');
      return uploader(file, hash);
    }

    return;
  }

  // Replace image links in posts
  private replaceLinksInPosts() {
    let count = 0;

    for (const post of posts) {
      const mdx = readFileSync(post, 'utf8');
      let { content, data } = matter(mdx);
      const inlineLinks = extractHttpsLinks(content);

      for (const link of inlineLinks) {
        if (this.cache[link]) {
          content = content.replaceAll(link, this.cache[link]);
          count++;
        }
      }

      // Update image links in specific fields

      if (data['image'] && this.cache[data['image']]) {
        data['image'] = this.cache[data['image']];
        count++;
      }

      if (data['seo']?.['image'] && this.cache[data['seo']?.['image']]) {
        data['seo']['image'] = this.cache[data['seo']['image']];
        count++;
      }

      writeFileSync(post, matter.stringify(content, data));
    }

    consola.success(`${count} images have been uploaded to CDN and links have been replaced`);
  }

  private replaceLinksInChangelogIndex() {
    let count = 0;
    changelogIndex.community = changelogIndex.community.map((post) => {
      if (!post.image) return post;
      if (this.cache[post.image]) {
        count++;
        return {
          ...post,
          image: this.cache[post.image],
        };
      }
      return post;
    });

    changelogIndex.cloud = changelogIndex.cloud.map((post) => {
      if (!post.image) return post;
      if (this.cache[post.image]) {
        count++;
        return {
          ...post,
          image: this.cache[post.image],
        };
      }
      return post;
    });

    writeJSONSync(changelogIndexPath, changelogIndex, { spaces: 2 });

    consola.success(
      `${count} changelog index images have been uploaded to CDN and links have been replaced`,
    );
  }

  // Run upload process
  async run() {
    const links = this.collectImageLinks();

    if (links.length > 0) {
      consola.info("Found images that haven't been uploaded to CDN:");
      consola.info(links);
      await this.uploadImagesToCDN(links);
    } else {
      consola.info('No new images to upload.');
    }

    // Replace image links in posts and changelog index
    this.replaceLinksInPosts();
    this.replaceLinksInChangelogIndex();
  }
}

// Instantiate and run
const instance = new ImageCDNUploader();

instance.run();
