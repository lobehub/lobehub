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

// 定义常量
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

  // 从文件加载缓存数据
  private loadCache() {
    try {
      this.cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    } catch (error) {
      consola.error('Failed to load cache', error);
    }
  }

  // 将缓存数据写入文件
  private writeCache() {
    try {
      writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      consola.error('Failed to write cache', error);
    }
  }

  // 收集所有的图片链接
  private collectImageLinks(): string[] {
    const links: string[][] = posts.map((post) => {
      const mdx = readFileSync(post, 'utf8');
      const { content, data } = matter(mdx);
      const inlineLinks: string[] = extractHttpsLinks(content);

      // 添加特定字段中的图片链接
      if (data?.image) inlineLinks.push(data.image);
      if (data?.seo?.image) inlineLinks.push(data.seo.image);

      // 过滤出有效的 CDN 链接
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

    // 合并和去重链接数组
    return mergeAndDeduplicateArrays(links.flat().concat(communityLinks, cloudLinks));
  }

  // 上传图片到 CDN
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

    // 更新缓存
    this.cache = { ...this.cache, ...cdnLinks };
    this.writeCache();
  }

  // 根据不同的 CDN 来处理文件上传
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

  // 替换文章中的图片链接
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

      // 更新特定字段的图片链接

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

  // 运行上传过程
  async run() {
    const links = this.collectImageLinks();

    if (links.length > 0) {
      consola.info("Found images that haven't been uploaded to CDN:");
      consola.info(links);
      await this.uploadImagesToCDN(links);
    } else {
      consola.info('No new images to upload.');
    }

    // 替换文章和 changelog index 中的图片链接
    this.replaceLinksInPosts();
    this.replaceLinksInChangelogIndex();
  }
}

// 实例化并运行
const instance = new ImageCDNUploader();

instance.run();
