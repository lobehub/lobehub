import { acceptanceIdFromReviewResource } from '@lobechat/const';
import { getUserAuth } from '@lobechat/utils/server';
import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { authEnv } from '@/envs/auth';
import { isAcceptanceReviewClient } from '@/libs/oidc-provider/acceptanceReview';
import { resolveReviewAccess } from '@/server/services/acceptanceReview/access';
import { OIDCService } from '@/server/services/oidc';
import type { OidcInteractionDetailsResponse, OidcInteractionErrorResponse } from '@/types/oidc';

const log = debug('lobe-oidc:interaction');

// The title is only revealed once the signed-in reviewer may read the acceptance.
const acceptanceReviewOf = async (
  resource: unknown,
): Promise<OidcInteractionDetailsResponse['acceptanceReview']> => {
  const acceptanceId = acceptanceIdFromReviewResource(
    Array.isArray(resource) ? resource[0] : resource,
  );
  const { userId } = await getUserAuth();
  if (!acceptanceId || !userId) return { allowed: false };
  const access = await resolveReviewAccess(await getServerDB(), userId, acceptanceId);
  if (!access) return { allowed: false };
  return {
    allowed: true,
    title: access.acceptance.metadata?.title || access.acceptance.requirement || undefined,
  };
};

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
    const acceptanceReview =
      details.prompt.name === 'consent' && isAcceptanceReviewClient(clientId)
        ? await acceptanceReviewOf(details.params.resource)
        : undefined;

    return NextResponse.json<OidcInteractionDetailsResponse>({
      acceptanceReview,
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
