import debug from 'debug';
import { type NextRequest } from 'next/server';
import { after, NextResponse } from 'next/server';

import { OAuthHandoffModel } from '@/database/models/oauthHandoff';
import { serverDB } from '@/database/server';
import { resolveAppOrigin } from '@/libs/oidc-provider/config';

const log = debug('lobe-oidc:callback:desktop');

const errorPathname = '/oauth/callback/error';

const buildRedirectUrl = (req: NextRequest, pathname: string): URL => {
  const url = new URL(resolveAppOrigin(req.headers));
  url.pathname = pathname;
  log('Redirect target: %s', url.toString());
  return url;
};

export const GET = async (req: NextRequest) => {
  try {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state'); // This `state` is the handoff ID

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      log('Missing code or state in form data');

      const errorUrl = buildRedirectUrl(req, errorPathname);
      errorUrl.searchParams.set('reason', 'invalid_request');

      log('Redirecting to error URL: %s', errorUrl.toString());
      return NextResponse.redirect(errorUrl);
    }

    log('Received OIDC callback. state(handoffId): %s', state);

    // The 'client' is 'desktop' because this redirect_uri is for the desktop client.
    const client = 'desktop';
    const payload = { code, state };
    const id = state;

    const authHandoffModel = new OAuthHandoffModel(serverDB);
    await authHandoffModel.create({ client, id, payload });
    log('Handoff record created successfully for id: %s', id);

    const successUrl = buildRedirectUrl(req, '/oauth/callback/success');

    // Add debug logging
    log('Request host header: %s', req.headers.get('host'));
    log('Request x-forwarded-host: %s', req.headers.get('x-forwarded-host'));
    log('Request x-forwarded-proto: %s', req.headers.get('x-forwarded-proto'));
    log('Constructed success URL: %s', successUrl.toString());

    // cleanup expired
    after(async () => {
      const cleanedCount = await authHandoffModel.cleanupExpired();

      log('Cleaned up %d expired handoff records', cleanedCount);
    });

    return NextResponse.redirect(successUrl);
  } catch (error) {
    log('Error in OIDC callback: %O', error);

    const errorUrl = buildRedirectUrl(req, errorPathname);
    errorUrl.searchParams.set('reason', 'internal_error');

    if (error instanceof Error) {
      errorUrl.searchParams.set('errorMessage', error.message);
    }

    log('Redirecting to error URL: %s', errorUrl.toString());
    return NextResponse.redirect(errorUrl);
  }
};
