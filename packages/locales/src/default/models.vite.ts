import { lobeHubOnlineModelDescriptions } from '../lobehubOnlineModelDescriptions';
import { modelDescriptionOverrides } from '../modelDescriptionOverrides';

/**
 * Vite SPA path: platform resolve rewrites `models.ts` → `models.vite.ts` so the
 * browser does not import the full model-bank catalog. Keep app-owned description
 * overrides here — including LobeHub provider-scoped keys — and use each model
 * card's English description as i18next `defaultValue` for everything else.
 */
export default {
  ...modelDescriptionOverrides,
  ...lobeHubOnlineModelDescriptions,
};
