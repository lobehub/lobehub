import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { buildProtectedResourceMetadata } from '@/libs/oidc-provider/discovery-metadata';

/** RFC 9728 protected resource metadata of the public REST API at `/api/v1`. */
export const GET = () =>
  Response.json(buildProtectedResourceMetadata(appEnv.APP_URL!, authEnv.ENABLE_OIDC), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
  });
