import dayjs from 'dayjs';
import { template } from 'es-toolkit/compat';
import matter from 'gray-matter';
import semver from 'semver';
import urlJoin from 'url-join';

import { FetchCacheTag } from '@/const/cacheControl';
import { type Locales } from '@/locales/resources';
import { type ChangelogIndexItem } from '@/types/changelog';
import { markdownToTxt } from '@/utils/markdownToTxt';

const URL_TEMPLATE = 'https://raw.githubusercontent.com/{{user}}/{{repo}}/{{branch}}/{{path}}';
const LAST_MODIFIED = new Date().toISOString();

const docCdnPrefix = process.env.DOC_S3_PUBLIC_DOMAIN || '';

export interface ChangelogConfig {
  branch: string;
  cdnPath: string;
  changelogPath: string;
  docsPath: string;
  majorVersion: number;
  repo: string;
  type: 'cloud' | 'community';
  urlTemplate: string;
  user: string;
}

export class ChangelogService {
  cdnUrls: {
    [key: string]: string;
  } = {};
  config: ChangelogConfig = {
    branch: process.env.DOCS_BRANCH || 'main',
    cdnPath: 'docs/.cdn.cache.json',
    changelogPath: 'changelog',
    docsPath: 'docs/changelog',
    majorVersion: 1,
    repo: 'lobe-chat',
    type: 'cloud',
    urlTemplate: process.env.CHANGELOG_URL_TEMPLATE || URL_TEMPLATE,
    user: 'lobehub',
  };

  async getLatestChangelogId() {
    const index = await this.getChangelogIndex();
    return index[0]?.id;
  }

  async getChangelogIndex(): Promise<ChangelogIndexItem[]> {
    try {
      const url = this.genUrl(urlJoin(this.config.docsPath, 'index.json'));

      const res = await fetch(url, {
        next: { revalidate: 3600, tags: [FetchCacheTag.Changelog] },
      });

      if (res.ok) {
        const data = await res.json();

        return this.mergeChangelogs(data.cloud, data.community).slice(0, 5);
      }

      return [];
    } catch (e) {
      const cause = (e as Error).cause as { code: string };
      if (cause?.code.includes('ETIMEDOUT')) {
        console.warn(
          '[ChangelogFetchTimeout] fail to fetch changelog lists due to network timeout. Please check your network connection.',
        );
      } else {
        console.error('Error getting changelog lists:', e);
      }

      return [];
    }
  }

  async getIndexItemById(id: string) {
    const index = await this.getChangelogIndex();
    return index.find((item) => item.id === id);
  }

  async getPostById(id: string, options?: { locale?: Locales }) {
    await this.cdnInit();
    try {
      const post = await this.getIndexItemById(id);

      const filename = options?.locale?.startsWith('zh') ? `${id}.zh-CN.mdx` : `${id}.mdx`;
      const url = this.genUrl(urlJoin(this.config.docsPath, filename));

      const response = await fetch(url, {
        next: { revalidate: 3600, tags: [FetchCacheTag.Changelog] },
      });

      const text = await response.text();
      const { data, content } = matter(text);

      const regex = /^#\s(.+)/;
      const match = regex.exec(content.trim());
      const matches = content.trim().split(regex);

      let description: string;

      if (matches[2]) {
        description = matches[2] ? matches[2].trim() : '';
      } else {
        description = matches[1] ? matches[1].trim() : '';
      }

      if (docCdnPrefix) {
        const images = this.extractHttpsLinks(content);
        for (const url of images) {
          const cdnUrl = this.replaceCdnUrl(url);
          if (cdnUrl && url !== cdnUrl) {
            description = description.replaceAll(url, cdnUrl);
          }
        }
      }

      return {
        date: post?.date
          ? new Date(post.date)
          : data?.date
            ? new Date(data.date)
            : new Date(LAST_MODIFIED),
        description: markdownToTxt(description.replaceAll('\n', '').replaceAll('  ', ' ')).slice(
          0,
          160,
        ),
        image: post?.image ? this.replaceCdnUrl(post.image) : undefined,
        tags: ['changelog'],
        title: match ? match[1] : '',
        ...data,
        content: description,
        rawTitle: match ? match[1] : '',
      };
    } catch (e) {
      console.error('[ChangelogFetchError]failed to fetch changlog post', id);
      console.error(e);

      return false as any;
    }
  }

  private mergeChangelogs(
    cloud: ChangelogIndexItem[],
    community: ChangelogIndexItem[],
  ): ChangelogIndexItem[] {
    if (this.config.type === 'community') {
      return community;
    }

    const merged = [...community];

    for (const cloudItem of cloud) {
      const index = merged.findIndex((item) => item.id === cloudItem.id);
      if (index !== -1) {
        merged[index] = cloudItem;
      } else {
        merged.push(cloudItem);
      }
    }

    return merged
      .map((item) => ({
        ...item,
        date: dayjs(item.date).format('YYYY-MM-DD'),
        versionRange: this.formatVersionRange(item.versionRange),
      }))
      .sort((a, b) => semver.rcompare(a.versionRange[0], b.versionRange[0]));
  }

  private formatVersionRange(range: string[]): string[] {
    if (range.length === 1) {
      return range;
    }

    const [v1, v2]: any = range.map((v) => semver.parse(v)?.toString());

    const minVersion = semver.lt(v1, v2) ? v1 : v2;
    const maxVersion = semver.gt(v1, v2) ? v1 : v2;

    return [minVersion, maxVersion];
  }

  private genUrl(path: string) {
    // Custom delimiter set to {{}}
    const compiledTemplate = template(this.config.urlTemplate, {
      interpolate: /\{\{([\s\S]+?)\}\}/g,
    });

    return compiledTemplate({ ...this.config, path });
  }

  private extractHttpsLinks(text: string) {
    const regex = /https:\/\/[^\s"')>]+/g;
    const links = text.match(regex);
    return links || [];
  }

  private async cdnInit() {
    if (!docCdnPrefix) return;
    if (Object.keys(this.cdnUrls).length === 0) {
      try {
        const url = this.genUrl(this.config.cdnPath);
        const res = await fetch(url);
        const data = await res.json();
        if (data) {
          this.cdnUrls = data;
        }
      } catch (error) {
        console.error('Error getting changelog cdn cache:', error);
      }
    }
  }

  private replaceCdnUrl(url: string) {
    if (url?.startsWith('/blog')) return urlJoin('https://hub-apac-1.lobeobjects.space/', url);
    return url;
  }
}
