import { getServerFeatureFlagsValue } from '@/config/featureFlags';
import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { buildAnalyticsConfig } from '@/libs/spaHtml';
import { getServerAuthConfig } from '@/server/globalConfig/getServerAuthConfig';

// The prerendered auth micro app ships without any deployment's config baked in;
// its worker reads this to fill `window.__SERVER_CONFIG__` before serving a page.
//
// Deliberately narrower than `AuthSPAServerConfig`: this endpoint is public and
// unauthenticated, so it carries only the fields the auth pages actually read.
// `enableBusinessFeatures` is not among them — it is a build-time constant.
export const GET = () => {
  const { disableEmailPassword, enableEmailVerification, enableMagicLink, oAuthSSOProviders } =
    getServerAuthConfig();

  return Response.json(
    {
      analyticsConfig: buildAnalyticsConfig(),
      config: {
        disableEmailPassword,
        enableEmailVerification,
        enableMagicLink,
        oAuthSSOProviders,
      },
      enableOIDC: authEnv.ENABLE_OIDC,
      featureFlags: getServerFeatureFlagsValue(),
      globalCDN: appEnv.CDN_USE_GLOBAL,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
      },
    },
  );
};
