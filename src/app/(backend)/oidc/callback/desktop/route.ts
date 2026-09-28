import debug from 'debug';
import { type NextRequest } from 'next/server';
import { after, NextResponse } from 'next/server';

import { OAuthHandoffModel } from '@/database/models/oauthHandoff';
import { serverDB } from '@/database/server';

const log = debug('lobe-oidc:callback:desktop');

const errorPathname = '/oauth/callback/error';

const redirectTo = (pathname: string, params?: Record<string, string>) => {
  const location = params ? `${pathname}?${new URLSearchParams(params)}` : pathname;
  log('Redirect target: %s', location);
  return new NextResponse(null, { headers: { location }, status: 307 });
};

export const GET = async (req: NextRequest) => {
  try {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state'); // This `state` is the handoff ID

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      log('Missing code or state in form data');

      return redirectTo(errorPathname, { reason: 'invalid_request' });
    }

    log('Received OIDC callback. state(handoffId): %s', state);

    // The 'client' is 'desktop' because this redirect_uri is for the desktop client.
    const client = 'desktop';
    const payload = { code, state };
    const id = state;

    const authHandoffModel = new OAuthHandoffModel(serverDB);
    await authHandoffModel.create({ client, id, payload });
    log('Handoff record created successfully for id: %s', id);

    // cleanup expired
    after(async () => {
      const cleanedCount = await authHandoffModel.cleanupExpired();

      log('Cleaned up %d expired handoff records', cleanedCount);
    });

    return redirectTo('/oauth/callback/success');
  } catch (error) {
    log('Error in OIDC callback: %O', error);

    return redirectTo(errorPathname, {
      reason: 'internal_error',
      ...(error instanceof Error && { errorMessage: error.message }),
    });
  }
};
