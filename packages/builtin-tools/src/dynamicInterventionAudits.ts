import { createDryRunAudit, DASHBOARD_DRY_RUN_AUDIT } from '@lobechat/builtin-tool-dashboard';
import { pathScopeAudit } from '@lobechat/builtin-tool-local-system';
import { type DynamicInterventionResolver } from '@lobechat/types';

export const dynamicInterventionAudits: Record<string, DynamicInterventionResolver> = {
  // Without a version loader this asks the user for every dry run; hosts that
  // can read the version (agent runtime service, client streaming executor)
  // register a loader-backed audit under the same key.
  [DASHBOARD_DRY_RUN_AUDIT]: createDryRunAudit(),
  pathScopeAudit,
};
