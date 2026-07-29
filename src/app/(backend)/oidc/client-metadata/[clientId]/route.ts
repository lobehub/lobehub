import { getUserAuth } from '@lobechat/utils/server';
import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';
import { OIDCService } from '@/server/services/oidc';
import type { OidcClientMetadata } from '@/types/oidc';

const log = debug('lobe-oidc:client-metadata');

export async function GET(_request: NextRequest, props: { params: Promise<{ clientId: string }> }) {
  if (!authEnv.ENABLE_OIDC) {
    log('OIDC is not enabled');
    return new NextResponse(null, { status: 404 });
  }

  const { userId } = await getUserAuth();
  if (!userId) {
    log('Unauthenticated request rejected');
    return new NextResponse(null, { status: 401 });
  }

  const { clientId } = await props.params;

  try {
    const oidcService = await OIDCService.initialize();
    const clientMetadata = await oidcService.getConsentClientMetadata(clientId);

    return NextResponse.json<OidcClientMetadata>(clientMetadata);
  } catch (error) {
    log('Error resolving client metadata for %s: %O', clientId, error);
    return new NextResponse(null, { status: 500 });
  }
}
