import { OFFICIAL_CLOUD_URL, OFFICIAL_URL } from '@lobechat/const';

import { useAppOrigin } from '@/hooks/useAppOrigin';

/**
 * Origin for acceptance and verify-report pages opened or shared outside the app.
 *
 * Desktop in cloud mode reports the gateway apex (`OFFICIAL_CLOUD_URL`) as its
 * app origin. The apex forwards most app routes, but `/acceptance/<id>` and
 * `/verify/<id>` belong to the marketing site there (it has its own
 * `/acceptance` page), so the report would land on a landing page or a 404.
 * Point those links at the app origin instead, matching the web build. Every
 * other origin (web, self-hosted) passes through unchanged.
 */
export const acceptanceOrigin = (appOrigin: string): string =>
  appOrigin.replace(/\/+$/, '') === OFFICIAL_CLOUD_URL ? OFFICIAL_URL : appOrigin;

export const useAcceptanceOrigin = () => acceptanceOrigin(useAppOrigin());
