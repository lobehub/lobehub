import { type LobeChatDatabase } from '@lobechat/database';
import urlJoin from 'url-join';

import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';

import { S3StaticFileImpl } from './s3';
import { type FileServiceImpl } from './type';

/**
 * Create file service module
 * Returns S3 file implementation for cloud storage
 */
export const createFileServiceModule = (db: LobeChatDatabase): FileServiceImpl => {
  const isS3Configured = !!(
    fileEnv.S3_ACCESS_KEY_ID &&
    fileEnv.S3_SECRET_ACCESS_KEY &&
    fileEnv.S3_ENDPOINT &&
    fileEnv.S3_BUCKET
  );

  if (!isS3Configured) {
    const failWrite = async () => {
      throw new Error('S3 environment variables are not set completely, please check your env');
    };

    return {
      createPreSignedUrl: failWrite,
      createPreSignedUrlForPreview: failWrite,
      deleteFile: failWrite,
      deleteFiles: failWrite,
      getFileByteArray: async () => new Uint8Array(),
      getFileContent: async () => '',
      getFileMetadata: async () => ({ contentLength: 0 }),
      getFullFileUrl: async (url) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        if (url.startsWith('/webapi/')) return urlJoin(appEnv.APP_URL, url);

        return url;
      },
      getKeyFromFullUrl: async (url) => {
        if (!url) return null;
        if (url.startsWith('/webapi/')) return url.replace(/^\/webapi\//, '');
        if (!url.startsWith('http://') && !url.startsWith('https://')) return url;

        try {
          const parsed = new URL(url);
          return parsed.pathname.startsWith('/webapi/')
            ? parsed.pathname.replace(/^\/webapi\//, '')
            : parsed.pathname.replace(/^\//, '');
        } catch {
          return null;
        }
      },
      uploadBuffer: failWrite,
      uploadContent: failWrite,
      uploadMedia: failWrite,
    };
  }

  return new S3StaticFileImpl(db);
};
