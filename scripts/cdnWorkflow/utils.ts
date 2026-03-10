import { resolve } from 'node:path';

import { readJSONSync } from 'fs-extra';
import { globSync } from 'glob';

import { opimized, opimizedGif } from './optimized';

export const fixWinPath = (path: string) => path.replaceAll('\\', '/');

export const root = resolve(__dirname, '../..');

export const posts = globSync(fixWinPath(resolve(root, 'docs/changelog/*.mdx')));

interface ChangelogItem {
  date: string;
  id: string;
  image?: string;
  versionRange: string[];
}

export const changelogIndexPath = resolve(root, 'docs/changelog/index.json');

export const changelogIndex: {
  cloud: ChangelogItem[];
  community: ChangelogItem[];
} = readJSONSync(changelogIndexPath);

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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Step 2: Create a blob from the response data
    const blob = await response.blob();
    let buffer: ArrayBuffer | Buffer = await blob.arrayBuffer();
    let type = getExtension(blob.type);
    if (type === '.gif') {
      buffer = await opimizedGif(buffer);
      type = '.webp';
    } else if (type === '.png' || type === '.jpg') {
      buffer = await opimized(buffer, width);
      type = '.webp';
    }

    const filename = Date.now().toString() + type;

    // Step 3: Create a file from the blob
    const file: File = new File([buffer as ArrayBuffer], filename, {
      lastModified: Date.now(),
      type: type === '.webp' ? 'image/webp' : blob.type,
    });

    return file;
  } catch (error) {
    console.error('Error fetching image as file:', error);
  }
};
