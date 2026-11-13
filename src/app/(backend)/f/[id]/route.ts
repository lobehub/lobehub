import debug from 'debug';
import { NextRequest } from 'next/server';

import { FileModel } from '@/database/models/file';
import { getServerDB } from '@/database/server';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import {
  resolveEnterpriseContentScopes,
  resolveManagedContentReader,
} from '@/server/services/enterpriseKnowledge/contentAccess';
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
 *
 * Non-enterprise links remain public by id. The proxy URL is
 * embedded in bare `<img>` tags, download links, and links shared to AI — none
 * of which can attach auth headers/cookies. Adding `checkAuth` here would break
 * every previously-shared `/f/:id` link. Distribution-managed enterprise
 * content requires the current authenticated caller's library access.
 */
export const GET = async (req: Request, segmentData: { params: Params }) => {
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

    // Classify with the owner's scope, then authorize the actual request. No
    // storage URL may be created before the enterprise policy has passed.
    try {
      const scopes = await resolveEnterpriseContentScopes({ serverDB: db, userId: file.userId }, [
        id,
      ]);
      if (scopes.has(id)) {
        const reader = resolveManagedContentReader(await createLambdaContext(new NextRequest(req)));
        if (!reader) return new Response('File not found', { status: 404 });
        await resolveEnterpriseContentScopes({ serverDB: db, userId: reader }, [id]);
      }
    } catch {
      return new Response('File not found', { status: 404 });
    }

    // Create file service with file owner's userId
    const fileService = new FileService(db, file.userId);

    const isDownload = new URL(req.url).searchParams.get('download') === '1';
    const redirectUrl = isDownload
      ? await fileService.createDownloadUrl(file.url, file.name)
      : await fileService.createCachedPreSignedUrlForPreview(file.url);
    log('Web S3 presigned URL generated (%s)', isDownload ? 'download' : 'preview');

    // Return 302 redirect
    return Response.redirect(redirectUrl, 302);
  } catch (error) {
    console.error('File proxy error:', error);
    return new Response('Internal server error', {
      status: 500,
    });
  }
};
