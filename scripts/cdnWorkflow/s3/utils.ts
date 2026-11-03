import CryptoJS from 'crypto-js';
import mime from 'mime';

import type { ImgInfo } from './types';

class FileNameGenerator {
  date: Date;
  info: ImgInfo;

  static fields = [
    'year',
    'month',
    'day',
    'fullName',
    'fileName',
    'extName',
    'timestamp',
    'timestampMS',
    'md5',
  ];

  constructor(info: ImgInfo) {
    this.date = new Date();
    this.info = info;
  }

  public year(): string {
    return `${this.date.getFullYear()}`;
  }

  public month(): string {
    return this.date.getMonth() < 9
      ? `0${this.date.getMonth() + 1}`
      : `${this.date.getMonth() + 1}`;
  }

  public day(): string {
    return this.date.getDate() < 9 ? `0${this.date.getDate()}` : `${this.date.getDate()}`;
  }

  public fullName(): string {
    return this.info.fileName;
  }

  public fileName(): string {
    return this.info.fileName.replace(this.info.extname, '');
  }

  public extName(): string {
    return this.info.extname.replace('.', '');
  }

  public timestamp(): string {
    return Math.floor(Date.now() / 1000).toString();
  }

  public timestampMS(): string {
    return Date.now().toString();
  }

  public md5(): string {
    const wordArray = CryptoJS.lib.WordArray.create(this.imgBuffer());
    const md5Hash = CryptoJS.MD5(wordArray);
    return md5Hash.toString(CryptoJS.enc.Hex);
  }
  private imgBuffer(): Buffer {
    return this.info.buffer;
  }
}

export function formatPath(info: ImgInfo, format?: string): string {
  if (!format) {
    return info.fileName;
  }

  const fileNameGenerator = new FileNameGenerator(info);

  let formatPath: string = format;

  for (const key of FileNameGenerator.fields) {
    const re = new RegExp(`{${key}}`, 'g');
    // @ts-ignore
    formatPath = formatPath.replace(re, fileNameGenerator[key]());
  }

  return formatPath;
}

export async function extractInfo(info: ImgInfo): Promise<{
  body?: Buffer;
  contentEncoding?: string;
  contentType?: string;
}> {
  const result: {
    body?: Buffer;
    contentEncoding?: string;
    contentType?: string;
  } = {};

  if (info.extname) {
    result.contentType = mime.getType(info.extname) as string;
  }
  result.body = info.buffer;

  return result;
}
