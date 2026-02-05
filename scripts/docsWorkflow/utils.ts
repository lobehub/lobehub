import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { globSync } from 'glob';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import { SPLIT } from './const';
import { opimized, opimizedGif } from './optimized';

export const updateDocs = (path: string, content: string) => {
  const md = readFileSync(path, 'utf8');
  const mds = md.split(SPLIT);
  mds[1] = [' ', content, ' '].join('\n\n');
  const result = mds.join(SPLIT);
  writeFileSync(path, result, 'utf8');
};

export const convertMarkdownToMdast = async (md: string) => {
  // @ts-ignore
  return unified().use(remarkParse).use(remarkGfm).parse(md.trim());
};

export const getTitle = async (path: string) => {
  const md = readFileSync(path, 'utf8');
  const mdast: any = await convertMarkdownToMdast(md);

  let title = '';
  visit(mdast, 'heading', (node) => {
    if (node.depth !== 1) return;
    visit(node, 'text', (heading) => {
      title += heading.value;
    });
  });
  return title;
};

export const genMdLink = (title: string, url: string) => {
  return `[${title}](${url})`;
};

export const fixWinPath = (path: string) => path.replaceAll('\\', '/');

export const root = resolve(__dirname, '../..');

export const posts = globSync(fixWinPath(resolve(root, 'docs/**/*.mdx')));

export const extractHttpsLinks = (text: string) => {
  const regex = /https:\/\/[^\s"')>]+/g;
  const links = text.match(regex);
  return links || [];
};

export const mergeAndDeduplicateArrays = (...arrays: string[][]) => {
  const combinedArray = arrays.flat();
  const uniqueSet = new Set(combinedArray);
  return Array.from(uniqueSet);
};

const mimeToExtensions = {
  'image/gif': '.gif',
  // 图片类型
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  // 视频类型
  'video/mp4': '.mp4',
  'video/mpeg': '.mpeg',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-flv': '.flv',
  'video/x-matroska': '.mkv',
  'video/x-ms-wmv': '.wmv',
  'video/x-msvideo': '.avi',
};

// @ts-ignore
const getExtension = (type: string) => mimeToExtensions?.[type] || '.png';

export const fetchImageAsFile = async (url: string, width: number) => {
  try {
    // Step 1: Fetch the image
    const githubToken = process.env.GITHUB_TOKEN;
    const headers =
      githubToken && url.startsWith('https://github.com/')
        ? {
            'Authorization': `Bearer ${githubToken}`,
            'User-Agent': 'lobe-chat-docs-cdn',
          }
        : undefined;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Step 2: Create a blob from the response data
    const blob = await response.blob();
    let buffer: any = await blob.arrayBuffer();
    let type = getExtension(blob.type);
    if (type === '.gif') {
      buffer = await opimizedGif(buffer);
      type = '.webp';
    } else if (type === '.png' || type === '.jpg') {
      buffer = await opimized(buffer, width);
      type = '.webp';
    }

    const now = Date.now();
    const filename = now.toString() + type;

    // Step 3: Create a file from the blob
    const file: File = new File([buffer], filename, {
      lastModified: now,
      type: type === '.webp' ? 'image/webp' : blob.type,
    });

    return file;
  } catch (error) {
    console.error('Error fetching image as file:', error);
  }
};
