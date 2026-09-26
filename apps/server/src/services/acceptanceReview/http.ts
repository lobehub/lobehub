import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import { validateAcceptanceReviewJWT } from '@/libs/trpc/utils/internalJwt';
import { acceptanceCommentSourceSchema } from '@/server/routers/lambda/acceptanceComment';

import { AcceptanceReviewSession, claimReviewHandoff } from './index';

/**
 * The embedded review toolbar's API: `/api/acceptance-review/<action>`.
 *
 * It runs on a third-party origin, so it gets CORS — but no cookies are ever
 * read here. The only credential is an acceptance-review token (Bearer), which
 * is bound to one acceptance and the origin the reviewer approved; a request
 * whose `Origin` is not that origin is refused even with a valid token. A
 * preflight carries no token, so it is answered for any origin: it grants
 * nothing, and the real request still has to present both.
 */

const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '600',
  ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}),
});

const json = (body: unknown, status: number, origin: string | null) =>
  Response.json(body, { headers: corsHeaders(origin), status });

const createSchema = z.object({
  clientId: z.string().trim().min(1).max(255).optional(),
  content: z.string().trim().min(1).max(10_000),
  // A data URL; the service checks type and size of the decoded bytes.
  screenshot: z.string().max(6_000_000).nullish(),
  source: acceptanceCommentSourceSchema,
});
const rejectSchema = z.object({ comment: z.string().trim().max(2000).optional() });

export const handleAcceptanceReviewPreflight = (request: Request) =>
  new Response(null, { headers: corsHeaders(request.headers.get('origin')), status: 204 });

export async function handleAcceptanceReviewRequest(request: Request, path: string[]) {
  const origin = request.headers.get('origin');
  try {
    // Claiming a parked session carries no token yet: the one-time handoff id
    // is the credential, and it only pays out to the approved origin.
    if (path[0] === 'handoff' && request.method.toUpperCase() === 'GET') {
      const handoff = new URL(request.url).searchParams.get('id') ?? '';
      if (!/^[\w-]{32,128}$/.test(handoff))
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid handoff id' });
      const session = await claimReviewHandoff(await getServerDB(), { handoff, origin });
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not approved yet' });
      return json(session, 200, origin);
    }

    const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    const claims = token ? await validateAcceptanceReviewJWT(token) : null;
    if (!claims)
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Review session expired or invalid' });
    // The token is only good where the reviewer approved it.
    if (!origin || origin !== claims.origin)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This review session belongs to another site',
      });

    const session = new AcceptanceReviewSession(await getServerDB(), claims);
    const [resource, id] = path;
    const method = request.method.toUpperCase();

    if (resource === 'session' && method === 'GET')
      return json(await session.describe(), 200, origin);
    if (resource === 'comments' && method === 'GET' && !id)
      return json({ items: await session.listMine() }, 200, origin);
    if (resource === 'comments' && method === 'POST' && !id) {
      const body = await request.json().catch(() => {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Body must be JSON' });
      });
      const input = createSchema.parse(body);
      return json(await session.create(input), 201, origin);
    }
    if (resource === 'comments' && method === 'DELETE' && id)
      return json(await session.remove(id), 200, origin);
    if (resource === 'reject' && method === 'POST') {
      const input = rejectSchema.parse(await request.json().catch(() => ({})));
      return json(await session.reject(input), 200, origin);
    }
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown review action' });
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: { code: 'BAD_REQUEST', issues: error.issues, message: 'Invalid request' } },
        400,
        origin,
      );
    if (error instanceof TRPCError)
      return json(
        { error: { code: error.code, message: error.message } },
        getHTTPStatusCodeFromError(error),
        origin,
      );
    console.error('[acceptance-review]', error);
    return json(
      { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Review request failed' } },
      500,
      origin,
    );
  }
}
