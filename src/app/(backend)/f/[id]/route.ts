import debug from 'debug';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { FileModel } from '@/database/models/file';
import { FileService } from '@/server/services/file';

const log = debug('lobe-file:proxy');

type Params = { id: string };

/**
 * File proxy service
 * GET /f/:id
 *
 * Resolves a file's storage URL to a short-lived S3 presigned URL and issues a
 * 302 redirect. Because the proxy URL is embedded in `<img>` tags and download
 * links (bare `/f/:id` — no way to attach `X-Workspace-Id`), workspace context
 * has to be derived from the row itself: we first locate the file by id
 * (unscoped), read its `workspaceId`, then re-run the lookup through
 * `FileModel(..., file.workspaceId)` so `buildWorkspaceWhere` enforces the
 * standard visibility rules. Same result as the ownership check TRPC would run
 * for a member: workspace-public files owned by another member resolve;
 * workspace-private / cross-workspace / cross-user rows surface as 404, which
 * LOBE-11270 relies on when a creator flips a file back from `public` to
 * `private`.
 */
// `checkAuth`'s public shape narrows `params` to the shared `{ provider? }`
// route family. The `/f/[id]` segment lives outside that family, so cast the
// exported handler back to the `{ id }` shape Next.js's dynamic-route type
// checker expects. Type-only cast — the runtime shape is unchanged.
const handler = checkAuth(async (_req: Request, { params, userId, serverDB }) => {
  try {
    const resolvedParams = (await (params as unknown as Promise<Params>)) as Params;
    const { id } = resolvedParams;

    log('File proxy request: %s (viewer=%s)', id, userId);

    // Locate the file first (no ownership filter) so we can read its
    // `workspaceId` from the row — the request itself carries no workspace
    // context on plain `<img>`/download hits.
    const locatedFile = await FileModel.getFileById(serverDB, id);
    if (!locatedFile) {
      log('File not found: %s', id);
      return new Response('File not found', {
        status: 404,
      });
    }

    // Re-run through the ownership-scoped model so `buildWorkspaceWhere`
    // applies the same visibility rules TRPC uses (workspace-public visible to
    // any member, private visible only to the creator, personal visible only
    // to the owner).
    const fileModel = new FileModel(serverDB, userId, locatedFile.workspaceId ?? undefined);
    const file = await fileModel.findById(id);

    if (!file) {
      log('File found but forbidden for viewer: %s', id);
      return new Response('File not found', {
        status: 404,
      });
    }

    // File service is scoped to the file's owner so it can build the storage
    // key correctly; access permission has already been enforced above.
    const fileService = new FileService(serverDB, file.userId);

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
});

export const GET = handler as unknown as (
  req: Request,
  ctx: { params: Promise<Params> },
) => Promise<Response>;
