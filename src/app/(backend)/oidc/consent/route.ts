import { getUserAuth } from '@lobechat/utils/server';
import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';

import { appEnv } from '@/envs/app';
import { OIDCService } from '@/server/services/oidc';

const log = debug('lobe-oidc:consent');

export async function POST(request: NextRequest) {
  log('Received POST request for /oidc/consent, URL: %s', request.url);
  try {
    const formData = await request.formData();
    const consent = formData.get('consent') as string;
    const uid = formData.get('uid') as string;

    log('POST /oauth/consent - uid=%s, choice=%s', uid, consent);

    const oidcService = await OIDCService.initialize();

    let details;
    try {
      details = await oidcService.getInteractionDetails(uid);
      log(
        'Interaction details found - prompt=%s, client=%s',
        details.prompt.name,
        details.params.client_id,
      );
    } catch (error) {
      log(
        'Error: Interaction details not found - %s',
        error instanceof Error ? error.message : 'unknown error',
      );
      if (error instanceof Error && error.message.includes('interaction session not found')) {
        return NextResponse.json(
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
      log(`User accepted the request, Handling 'login' prompt`);
      const { userId } = await getUserAuth();
      log('Obtained userId: %s', userId);

      if (details.prompt.name === 'login') {
        result = {
          login: { accountId: userId, remember: true },
        };
      } else {
        log(`Handling 'consent' prompt`);

        // 1. Get necessary IDs
        const clientId = details.params.client_id as string;

        // 2. Find or create Grant object
        const grant = await oidcService.findOrCreateGrants(userId!, clientId, details.grantId);

        // 3. Add user-consented scopes and claims to Grant object
        //    This information is typically in details.prompt.details
        const missingOIDCScope = (prompt.details.missingOIDCScope as string[]) || [];
        if (missingOIDCScope) {
          grant.addOIDCScope(missingOIDCScope.join(' '));
          log('Added OIDC scopes to grant: %s', missingOIDCScope.join(' '));
        }
        const missingOIDCClaims = (prompt.details.missingOIDCClaims as string[]) || [];
        if (missingOIDCClaims) {
          grant.addOIDCClaims(missingOIDCClaims);
          log('Added OIDC claims to grant: %s', missingOIDCClaims.join(' '));
        }

        const missingResourceScopes =
          (prompt.details.missingResourceScopes as Record<string, string[]>) || {};
        if (missingResourceScopes) {
          for (const [indicator, scopes] of Object.entries(missingResourceScopes)) {
            grant.addResourceScope(indicator, scopes.join(' '));
            log('Added resource scopes for %s to grant: %s', indicator, scopes.join(' '));
          }
        }
        // If RAR (Rich Authorization Requests) is used, it also needs to be added to grant
        // if (prompt.details.rar) {
        //   prompt.details.rar.forEach(detail => grant.addRar(detail));
        // }

        // 4. Save Grant object to get its jti (grantId)
        const newGrantId = await grant.save();
        log('Saved grant with ID: %s', newGrantId);

        // 5. Prepare result containing grantId
        result = { consent: { grantId: newGrantId } };

        log('Consent result prepared with grantId');
      }
      log('User %s the authorization', consent);
    } else {
      log('User rejected the request');
      result = {
        error: 'access_denied',
        error_description: 'User denied the authorization request',
      };
      log('User %s the authorization', consent);
    }

    log('Interaction Result: %O', result);

    const internalRedirectUrlString = await oidcService.getInteractionResult(uid, result);
    log('OIDC Provider internal redirect URL string: %s', internalRedirectUrlString);

    // Use APP_URL directly as base
    if (appEnv.APP_URL) {
      const baseUrl = new URL(appEnv.APP_URL);
      const internalUrl = new URL(internalRedirectUrlString);
      baseUrl.pathname = internalUrl.pathname;
      baseUrl.search = internalUrl.search;
      baseUrl.hash = internalUrl.hash;
      const finalRedirectUrl = baseUrl;
      log('Using APP_URL as base for redirect: %s', finalRedirectUrl.toString());
      return NextResponse.redirect(finalRedirectUrl, {
        status: 303,
      });
    }

    // Fallback: use original internal URL
    log('Using internal redirect URL directly: %s', internalRedirectUrlString);
    return NextResponse.redirect(new URL(internalRedirectUrlString), {
      status: 303,
    });
  } catch (error) {
    log('Error processing consent: %s', error instanceof Error ? error.message : 'unknown error');
    console.error('Error processing consent:', error);
    return NextResponse.json(
      {
        error: 'server_error',
        error_description: 'Error processing consent',
      },
      { status: 500 },
    );
  }
}
