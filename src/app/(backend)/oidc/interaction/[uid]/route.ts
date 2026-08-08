import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';
import { OIDCService } from '@/server/services/oidc';
import type { OidcInteractionDetailsResponse, OidcInteractionErrorResponse } from '@/types/oidc';

const log = debug('lobe-oidc:interaction');

export async function GET(request: NextRequest, props: { params: Promise<{ uid: string }> }) {
  if (!authEnv.ENABLE_OIDC) {
    log('OIDC is not enabled');
    return new NextResponse(null, { status: 404 });
  }

  const { uid } = await props.params;
  log('Received GET request for /oidc/interaction/%s, URL: %s', uid, request.url);

  try {
    const oidcService = await OIDCService.initialize();
    const details = await oidcService.getInteractionDetails(uid);

    log(
      'Interaction details found - prompt=%s, client=%s',
      details.prompt.name,
      details.params.client_id,
    );

    if (details.prompt.name !== 'consent' && details.prompt.name !== 'login') {
      return NextResponse.json<OidcInteractionErrorResponse>(
        { error: 'unsupported_interaction', promptName: details.prompt.name },
        { status: 409 },
      );
    }

    const clientId = (details.params.client_id as string) || 'unknown';
    const scopes = (details.params.scope as string)?.split(' ') || [];

    const clientMetadata = await oidcService.getConsentClientMetadata(clientId);

    return NextResponse.json<OidcInteractionDetailsResponse>({
      clientId,
      clientMetadata,
      prompt: details.prompt.name,
      redirectUri: details.params.redirect_uri as string,
      scopes,
      uid,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : undefined;

    if (errorMessage?.includes('interaction session not found')) {
      return NextResponse.json<OidcInteractionErrorResponse>(
        { error: 'session_invalid' },
        { status: 400 },
      );
    }

    log('Error handling OIDC interaction: %O', error);
    return NextResponse.json<OidcInteractionErrorResponse>(
      { error: 'server_error' },
      { status: 500 },
    );
  }
}
