import debug from 'debug';

import { FileModel } from '@/database/models/file';
import { getServerDB } from '@/database/server';
import { FileService } from '@/server/services/file';

const log = debug('lobe-file:proxy');

type Params = Promise<{ id: string }>;

/**
 * File proxy service
 * GET /f/:id
 *
 * Features:
 * - Query database to get file record (without userId filter for public access)
 * - Generate a temporary S3 presigned preview URL
 * - Return 302 redirect
 */
export const GET = async (_req: Request, segmentData: { params: Params }) => {
  try {
    const params = await segmentData.params;
    const { id } = params;

    log('File proxy request: %s', id);

    // Get database connection
    const db = await getServerDB();

    // Query file record without userId filter (public access)
    const file = await FileModel.getFileById(db, id);

    if (!file) {
      log('File not found: %s', id);
      return new Response('File not found', {
        status: 404,
      });
    }

    // Create file service with file owner's userId
    const fileService = new FileService(db, file.userId);

    // Web: Generate a cached S3 presigned URL, normalizing legacy full S3 URLs.
    const redirectUrl = await fileService.createCachedPreSignedUrlForPreview(file.url);
    log('Web S3 presigned URL generated');

    // Return 302 redirect
    return Response.redirect(redirectUrl, 302);
  } catch (error) {
    console.error('File proxy error:', error);
    return new Response('Internal server error', {
      status: 500,
    });
  }
};
