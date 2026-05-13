import { oidcSessions } from '@lobechat/database/schemas';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import { auth } from '@/auth';
import { OAuthHandoffModel } from '@/database/models/oauthHandoff';
import { serverDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { createNodeRequest, createNodeResponse } from '@/libs/oidc-provider/http-adapter';
import { OIDCService } from '@/server/services/oidc';
import { getOIDCProvider } from '@/server/services/oidc/oidcProvider';

const callbackLog = debug('lobe-oidc:callback:desktop');
const clearSessionLog = debug('lobe-oidc:clear-session');
const consentLog = debug('lobe-oidc:consent');
const handoffLog = debug('lobe-oidc:handoff');
const providerLog = debug('lobe-oidc:route');

type OIDCProviderMiddleware = (
  request: Awaited<ReturnType<typeof createNodeRequest>>,
  response: ReturnType<typeof createNodeResponse>['nodeResponse'],
  next?: (error?: Error) => void,
) => void;

export interface OIDCCallbackDesktopAPIHandlerOptions {
  scheduleAfterResponse?: (task: () => Promise<void>) => void;
}

const errorPathname = '/oauth/callback/error';

const runAsyncAfterResponse = (task: () => Promise<void>) => {
  setTimeout(() => {
    void task().catch((error) => {
      console.error('[oidc/callback/desktop] post-response task failed', error);
    });
  }, 0);
};

const buildRedirectUrl = (request: Request, pathname: string): URL => {
  if (appEnv.APP_URL) {
    try {
      const baseUrl = new URL(appEnv.APP_URL);
      baseUrl.pathname = pathname;
      callbackLog('Using APP_URL for redirect: %s', baseUrl.toString());
      return baseUrl;
    } catch (error) {
      callbackLog('Error parsing APP_URL, using fallback: %O', error);
    }
  }

  callbackLog('Warning: APP_URL not configured, using request URL as fallback');
  const fallbackUrl = new URL(request.url);
  fallbackUrl.pathname = pathname;
  fallbackUrl.search = '';
  fallbackUrl.hash = '';
  return fallbackUrl;
};

const parseCookieHeader = (cookieHeader: string | null): Record<string, string> => {
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex < 0) return [part, ''];

        return [part.slice(0, separatorIndex), decodeURIComponent(part.slice(separatorIndex + 1))];
      }),
  );
};

const createExpiredCookie = (name: string) =>
  `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly`;

export const oidcCallbackDesktopAPIHandler = async (
  request: Request,
  options: OIDCCallbackDesktopAPIHandlerOptions = {},
) => {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      callbackLog('Missing code or state in form data');

      const errorUrl = buildRedirectUrl(request, errorPathname);
      errorUrl.searchParams.set('reason', 'invalid_request');

      callbackLog('Redirecting to error URL: %s', errorUrl.toString());
      return Response.redirect(errorUrl, 307);
    }

    callbackLog('Received OIDC callback. state(handoffId): %s', state);

    const client = 'desktop';
    const payload = { code, state };
    const id = state;

    const authHandoffModel = new OAuthHandoffModel(serverDB);
    await authHandoffModel.create({ client, id, payload });
    callbackLog('Handoff record created successfully for id: %s', id);

    const successUrl = buildRedirectUrl(request, '/oauth/callback/success');

    callbackLog('Request host header: %s', request.headers.get('host'));
    callbackLog('Request x-forwarded-host: %s', request.headers.get('x-forwarded-host'));
    callbackLog('Request x-forwarded-proto: %s', request.headers.get('x-forwarded-proto'));
    callbackLog('Constructed success URL: %s', successUrl.toString());

    const scheduleAfterResponse = options.scheduleAfterResponse ?? runAsyncAfterResponse;
    scheduleAfterResponse(async () => {
      const cleanedCount = await authHandoffModel.cleanupExpired();

      callbackLog('Cleaned up %d expired handoff records', cleanedCount);
    });

    return Response.redirect(successUrl, 307);
  } catch (error) {
    callbackLog('Error in OIDC callback: %O', error);

    const errorUrl = buildRedirectUrl(request, errorPathname);
    errorUrl.searchParams.set('reason', 'internal_error');

    if (error instanceof Error) {
      errorUrl.searchParams.set('errorMessage', error.message);
    }

    callbackLog('Redirecting to error URL: %s', errorUrl.toString());
    return Response.redirect(errorUrl, 307);
  }
};

export const oidcClearSessionAPIHandler = async (request: Request) => {
  try {
    const session = await auth.api.getSession({
      headers: Object.fromEntries(request.headers.entries()),
    });
    const userId = session?.user?.id;
    if (!userId) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cookies = parseCookieHeader(request.headers.get('cookie'));
    const sessionId = cookies._session;

    if (!sessionId) {
      clearSessionLog('No _session cookie found, nothing to clear');
      return Response.json({ ok: true, cleared: false });
    }

    clearSessionLog('Clearing OIDC session %s for user %s', sessionId, userId);

    await serverDB.delete(oidcSessions).where(eq(oidcSessions.id, sessionId));

    const response = Response.json({ ok: true, cleared: true });
    for (const name of ['_session', '_session.sig', '_session.legacy', '_session.legacy.sig']) {
      response.headers.append('Set-Cookie', createExpiredCookie(name));
    }

    clearSessionLog('OIDC session cleared successfully');
    return response;
  } catch (error) {
    clearSessionLog('Error clearing OIDC session: %O', error);
    return Response.json({ ok: true, cleared: false, error: 'internal' });
  }
};

export const oidcConsentAPIHandler = async (request: Request) => {
  consentLog('Received POST request for /oidc/consent, URL: %s', request.url);
  try {
    const formData = await request.formData();
    const consent = formData.get('consent') as string;
    const uid = formData.get('uid') as string;

    consentLog('POST /oauth/consent - uid=%s, choice=%s', uid, consent);

    const oidcService = await OIDCService.initialize();

    let details;
    try {
      details = await oidcService.getInteractionDetails(uid, request);
      consentLog(
        'Interaction details found - prompt=%s, client=%s',
        details.prompt.name,
        details.params.client_id,
      );
    } catch (error) {
      consentLog(
        'Error: Interaction details not found - %s',
        error instanceof Error ? error.message : 'unknown error',
      );
      if (error instanceof Error && error.message.includes('interaction session not found')) {
        return Response.json(
          {
            error: 'invalid_request',
            error_description:
              'Authorization session expired or invalid, please restart the authorization flow',
          },
          { status: 400 },
        );
      }
      throw error;
    }

    const { prompt } = details;
    let result;
    if (consent === 'accept') {
      consentLog(`User accepted the request, Handling 'login' prompt`);
      const session = await auth.api.getSession({
        headers: Object.fromEntries(request.headers.entries()),
      });
      const userId = session?.user?.id;
      consentLog('Obtained userId: %s', userId);

      if (details.prompt.name === 'login') {
        result = {
          login: { accountId: userId, remember: true },
        };
      } else {
        consentLog(`Handling 'consent' prompt`);

        const clientId = details.params.client_id as string;

        const grant = await oidcService.findOrCreateGrants(userId!, clientId, details.grantId);

        const missingOIDCScope = (prompt.details.missingOIDCScope as string[]) || [];
        if (missingOIDCScope) {
          grant.addOIDCScope(missingOIDCScope.join(' '));
          consentLog('Added OIDC scopes to grant: %s', missingOIDCScope.join(' '));
        }
        const missingOIDCClaims = (prompt.details.missingOIDCClaims as string[]) || [];
        if (missingOIDCClaims) {
          grant.addOIDCClaims(missingOIDCClaims);
          consentLog('Added OIDC claims: %s', missingOIDCClaims.join(' '));
        }

        const missingResourceScopes =
          (prompt.details.missingResourceScopes as Record<string, string[]>) || {};
        if (missingResourceScopes) {
          for (const [indicator, scopes] of Object.entries(missingResourceScopes)) {
            grant.addResourceScope(indicator, scopes.join(' '));
            consentLog('Added resource scopes for %s to grant: %s', indicator, scopes.join(' '));
          }
        }

        const newGrantId = await grant.save();
        consentLog('Saved grant with ID: %s', newGrantId);

        result = { consent: { grantId: newGrantId } };

        consentLog('Consent result prepared with grantId');
      }
      consentLog('User %s the authorization', consent);
    } else {
      consentLog('User rejected the request');
      result = {
        error: 'access_denied',
        error_description: 'User denied the authorization request',
      };
      consentLog('User %s the authorization', consent);
    }

    consentLog('Interaction Result: %O', result);

    const internalRedirectUrlString = await oidcService.getInteractionResult(uid, result, request);
    consentLog('OIDC Provider internal redirect URL string: %s', internalRedirectUrlString);

    if (appEnv.APP_URL) {
      const baseUrl = new URL(appEnv.APP_URL);
      const internalUrl = new URL(internalRedirectUrlString);
      baseUrl.pathname = internalUrl.pathname;
      baseUrl.search = internalUrl.search;
      baseUrl.hash = internalUrl.hash;
      const finalRedirectUrl = baseUrl;
      consentLog('Using APP_URL as base for redirect: %s', finalRedirectUrl.toString());
      return Response.redirect(finalRedirectUrl, 303);
    }

    consentLog('Using internal redirect URL directly: %s', internalRedirectUrlString);
    return Response.redirect(new URL(internalRedirectUrlString), 303);
  } catch (error) {
    console.error('Error processing consent:', error);
    return Response.json(
      {
        error: 'server_error',
        error_description: 'Error processing consent',
      },
      { status: 500 },
    );
  }
};

export const oidcProviderAPIHandler = async (request: Request) => {
  const requestUrl = new URL(request.url);
  providerLog(
    `Received ${request.method.toUpperCase()} request: %s %s`,
    request.method,
    request.url,
  );
  providerLog('Path: %s, Pathname: %s', requestUrl.pathname, requestUrl.pathname);

  let responseCollector;

  try {
    if (!authEnv.ENABLE_OIDC) {
      providerLog('OIDC is not enabled');
      return new Response('OIDC is not enabled', { status: 404 });
    }

    const provider = await getOIDCProvider();

    providerLog(`Calling provider.callback() for ${request.method}`);
    await new Promise<void>((resolve, reject) => {
      let middleware: OIDCProviderMiddleware;
      try {
        providerLog('Attempting to get middleware from provider.callback()');
        middleware = provider.callback() as OIDCProviderMiddleware;
        providerLog('Successfully obtained middleware function.');
      } catch (syncError) {
        providerLog('SYNC ERROR during provider.callback() call itself: %O', syncError);
        reject(syncError);
        return;
      }

      responseCollector = createNodeResponse(resolve);
      const nodeResponse = responseCollector.nodeResponse;

      void createNodeRequest(request).then((nodeRequest) => {
        providerLog('Calling the obtained middleware...');
        middleware(nodeRequest, nodeResponse, (error?: Error) => {
          providerLog('Middleware callback function HAS BEEN EXECUTED.');
          if (error) {
            providerLog('Middleware error reported via callback: %O', error);
            reject(error);
          } else {
            providerLog(
              'Middleware completed successfully via callback (may be redundant if .end() was called).',
            );
            resolve();
          }
        });
        providerLog('Middleware call initiated, waiting for its callback OR nodeResponse.end()...');
      });
    });

    providerLog('Promise surrounding middleware call resolved.');

    if (!responseCollector) {
      throw new Error('ResponseCollector was not initialized.');
    }

    const {
      responseBody: finalBody,
      responseHeaders: finalHeaders,
      responseStatus: finalStatus,
    } = responseCollector;

    providerLog('Final Response Status: %d', finalStatus);
    providerLog('Final Response Headers: %O', finalHeaders);

    return new Response(finalBody, {
      headers: finalHeaders as HeadersInit,
      status: finalStatus,
    });
  } catch (error) {
    providerLog(`Error handling OIDC ${request.method} request: %O`, error);
    return new Response(`Internal Server Error: ${(error as Error).message}`, { status: 500 });
  }
};

export const oidcHandoffAPIHandler = async (request: Request) => {
  handoffLog('Received GET request for /oidc/handoff');

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const client = searchParams.get('client');

    if (!id || !client) {
      return Response.json(
        { error: 'Missing required parameters: id and client' },
        { status: 400 },
      );
    }

    handoffLog('Fetching handoff record - id=%s, client=%s', id, client);

    const authHandoffModel = new OAuthHandoffModel(serverDB);
    const result = await authHandoffModel.fetchAndConsume(id, client);

    if (!result) {
      handoffLog('Handoff record not found or expired - id=%s', id);
      return Response.json({ error: 'Handoff record not found or expired' }, { status: 404 });
    }

    handoffLog('Handoff record found and consumed - id=%s', id);

    return Response.json({ data: result, success: true });
  } catch (error) {
    console.error('Error fetching handoff record: %O', error);

    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
};
