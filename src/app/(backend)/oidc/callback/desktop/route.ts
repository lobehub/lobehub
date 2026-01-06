import debug from 'debug';
import { type NextRequest, NextResponse, after } from 'next/server';

import { OAuthHandoffModel } from '@/database/models/oauthHandoff';
import { serverDB } from '@/database/server';
import { correctOIDCUrl } from '@/utils/server/correctOIDCUrl';

const log = debug('lobe-oidc:callback:desktop');

const errorPathname = '/oauth/callback/error';

/**
 * 安全地构建重定向URL
 */
const buildRedirectUrl = (req: NextRequest, pathname: string): URL => {
  const forwardedHost = req.headers.get('x-forwarded-host');
  const requestHost = req.headers.get('host');
  const forwardedProto =
    req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol');

  // 确定实际的主机名，提供后备值
  const actualHost = forwardedHost || requestHost;
  const actualProto = forwardedProto || 'https';

  log(
    'Building redirect URL - host: %s, proto: %s, pathname: %s',
    actualHost,
    actualProto,
    pathname,
  );

  // 如果主机名仍然无效，使用req.nextUrl作为后备
  if (!actualHost) {
    log('Warning: Invalid host detected, using req.nextUrl as fallback');
    const fallbackUrl = req.nextUrl.clone();
    fallbackUrl.pathname = pathname;
    return fallbackUrl;
  }

  try {
    return new URL(`${actualProto}://${actualHost}${pathname}`);
  } catch (error) {
    log('Error constructing URL, using req.nextUrl as fallback: %O', error);
    const fallbackUrl = req.nextUrl.clone();
    fallbackUrl.pathname = pathname;
    return fallbackUrl;
  }
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

    // 添加调试日志
    log('Request host header: %s', req.headers.get('host'));
    log('Request x-forwarded-host: %s', req.headers.get('x-forwarded-host'));
    log('Request x-forwarded-proto: %s', req.headers.get('x-forwarded-proto'));
    log('Constructed success URL: %s', successUrl.toString());

    const correctedUrl = correctOIDCUrl(req, successUrl);
    log('Final redirect URL: %s', correctedUrl.toString());

    // cleanup expired
    after(async () => {
      const cleanedCount = await authHandoffModel.cleanupExpired();

      log('Cleaned up %d expired handoff records', cleanedCount);
    });

    return NextResponse.redirect(correctedUrl);
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
