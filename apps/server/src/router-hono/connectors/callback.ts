import type { Context } from 'hono';
import { z } from 'zod';

const querySchema = z.object({ connectionId: z.uuid(), session: z.uuid() });
interface BoundOperation {
  expiresAt: number;
  id: string;
  session: string;
}

/** This callback carries no credentials or authority to enable an agent. */
export const personalConnectorCallback =
  (find: (id: string, session: string) => Promise<BoundOperation | null>) => async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    const query = querySchema.safeParse(c.req.query());
    if (!query.success)
      return c.text('Invalid authorization operation. Return to Toby to check its status.', 400);
    const { connectionId, session } = query.data;
    const operation = await find(connectionId, session);
    if (
      !operation ||
      operation.id !== connectionId ||
      operation.session !== session ||
      operation.expiresAt <= Date.now()
    )
      return c.text(
        'This authorization operation is unavailable. Return to Toby to check its status.',
        400,
      );
    const target = new URL('https://lobehub.com/oidc/callback/toby');
    target.searchParams.set('connectionId', connectionId);
    target.searchParams.set('session', session);
    return c.redirect(target.toString(), 302);
  };
