import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import type { Context, Next } from 'hono';

import { ApiException } from '../common/errors';

/**
 * Gate a route on the cloud business layer.
 *
 * Team workspaces, invitations, audit logs and page / artifact publishing are
 * implemented by the cloud overlay of `@/business/server/*`; the open-source
 * build ships typed no-op stubs there (an empty member list, a `null`
 * workspace) so its own UI keeps type-checking. Read through REST those stubs
 * would pass for real data, so a self-hosted instance answers these routes
 * with `501 feature_unavailable` instead. `ENABLE_BUSINESS_FEATURES` is the
 * same build-time switch the cloud overlay flips for every other business
 * capability.
 */
export const requireBusinessFeature =
  (feature: string, enabled: () => boolean = () => ENABLE_BUSINESS_FEATURES) =>
  async (_c: Context, next: Next) => {
    if (!enabled()) {
      throw new ApiException(
        501,
        'feature_unavailable',
        `${feature} is not available on this deployment`,
      );
    }

    return next();
  };
