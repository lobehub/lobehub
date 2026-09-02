import { checkAuth } from '@/app/(backend)/middleware/auth';
import { DocumentModel } from '@/database/models/document';
import { getIdFromIdentifier } from '@/utils/identifier';

import {
  consumeUrlMetadataRateLimit,
  fetchUrlMetadata,
  getLobeDocumentIdentifierFromUrl,
  UrlMetadataError,
} from '../../../../server/services/urlMetadata';
import { resolveValidWorkspaceIdFromRequest } from '../_utils/workspace';

const getDocumentDescription = (description?: null | string, content?: null | string) => {
  const value = description || content;
  const cleaned = value?.replaceAll(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 240) : undefined;
};

export const GET = checkAuth(async (request, { serverDB, userId }) => {
  const url = new URL(request.url).searchParams.get('url');
  if (!url) return Response.json({ error: 'url query parameter is required' }, { status: 400 });

  try {
    const documentIdentifier = getLobeDocumentIdentifierFromUrl(
      url,
      request.url,
      process.env.NODE_ENV === 'development',
    );

    if (documentIdentifier) {
      const documentId = getIdFromIdentifier(documentIdentifier, 'docs');
      const workspaceId = await resolveValidWorkspaceIdFromRequest({
        req: request,
        serverDB,
        userId,
      });
      const workspaceDocument = await new DocumentModel(serverDB, userId, workspaceId).findById(
        documentId,
      );
      const document =
        workspaceDocument ||
        (workspaceId ? await new DocumentModel(serverDB, userId).findById(documentId) : undefined);
      if (!document) {
        return Response.json({ error: 'Document not found' }, { status: 404 });
      }

      const target = new URL(url);
      return Response.json({
        description: getDocumentDescription(document.description, document.content),
        icon: new URL('/favicon.ico', target).toString(),
        title: document.title || document.filename || 'Untitled document',
        url: target.toString(),
      });
    }

    const rateLimit = consumeUrlMetadataRateLimit(userId);
    if (!rateLimit.allowed) {
      return Response.json(
        { error: 'Too many URL metadata requests' },
        {
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
          status: 429,
        },
      );
    }

    const metadata = await fetchUrlMetadata(url, {
      allowLocalhost: process.env.NODE_ENV === 'development',
    });
    return Response.json(metadata);
  } catch (error) {
    const status = error instanceof UrlMetadataError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unable to fetch URL metadata';
    return Response.json({ error: message }, { status });
  }
});
