import { NextRequest } from 'next/server';

import { GET as oidcHandler } from '@/app/(backend)/oidc/[...oidc]/route';
import { appEnv } from '@/envs/app';
import { oidcDiscoveryUrl } from '@/libs/oidc-provider/discovery-metadata';

/**
 * RFC 8414 authorization server metadata of the issuer `<origin>/oidc`, at its
 * path-inserted well-known URL. It is the provider's own OpenID discovery document
 * (a superset of RFC 8414), served by the provider, so the two can never disagree.
 * With OIDC disabled the provider handler answers 404, and so does this route.
 */
export const GET = async (req: NextRequest) => {
  const discovery = await oidcHandler(
    new NextRequest(oidcDiscoveryUrl(appEnv.APP_URL!), { headers: req.headers, method: 'GET' }),
  );
  if (!discovery.ok) return discovery;

  return Response.json(await discovery.json(), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
  });
};
