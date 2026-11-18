import { getUserAuth } from '@lobechat/utils/server';
import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';
import { isAcceptanceExtensionClient } from '@/libs/oidc-provider/acceptanceReview';
import { OIDCService } from '@/server/services/oidc';

const log = debug('lobe-oidc:extension-sign-in');

const seeOther = (location: string) =>
  new NextResponse(null, { headers: { location }, status: 303 });

const webSessionLogin = async (uid: string) => {
  const oidcService = await OIDCService.initialize();
  const details = await oidcService.getInteractionDetails(uid);
  if (
    details.prompt.name !== 'login' ||
    !isAcceptanceExtensionClient(details.params.client_id as string | undefined)
  )
    return undefined;

  const { userId } = await getUserAuth();
  if (!userId) return undefined;

  const resume = await oidcService.getInteractionResult(uid, {
    login: { accountId: userId, remember: true },
  });
  // The gateway rewrites Host on the way to the origin, so only a relative Location keeps the
  // browser on the origin that holds the interaction cookies.
  const { hash, pathname, search } = new URL(resume);
  return `${pathname}${search}${hash}`;
};

export async function GET(request: NextRequest, props: { params: Promise<{ uid: string }> }) {
  if (!authEnv.ENABLE_OIDC) return new NextResponse(null, { status: 404 });

  const { uid } = await props.params;
  const consentPage = `/oauth/consent/${uid}${new URL(request.url).search}`;
  try {
    return seeOther((await webSessionLogin(uid)) ?? consentPage);
  } catch (error) {
    log('Falling back to the consent page for %s: %O', uid, error);
    return seeOther(consentPage);
  }
}
