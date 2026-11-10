import {
  AGENT_ACCOUNT_OUTBOUND_AUDIT,
  agentAccountOutboundAudit,
} from '@lobechat/builtin-tool-agent-account';
import { createDryRunAudit, DASHBOARD_DRY_RUN_AUDIT } from '@lobechat/builtin-tool-dashboard';
import { createPathScopeAudit } from '@lobechat/builtin-tool-local-system';
import { isDesktop } from '@lobechat/const';

import { dashboardService } from '@/services/dashboard';
import { localFileService } from '@/services/electron/localFileService';
import { getUserStoreState } from '@/store/user/store';

/**
 * Dynamic intervention audits for runs driven by this client: each reads what
 * the call would touch through the client's own services and the signed-in
 * user's settings.
 */
export const clientInterventionAudits = {
  [DASHBOARD_DRY_RUN_AUDIT]: createDryRunAudit({
    loadGrants: () => getUserStoreState().settings.tool?.widgetDryRunGrants,
    loadVersion: (widgetId, versionId) => dashboardService.getVersion(widgetId, versionId),
  }),
  [AGENT_ACCOUNT_OUTBOUND_AUDIT]: agentAccountOutboundAudit,
  pathScopeAudit: createPathScopeAudit({
    areAllPathsSafe: async ({ paths, resolveAgainstScope }) => {
      if (!isDesktop) return false;

      const result = await localFileService.auditSafePaths({ paths, resolveAgainstScope });
      return result.allSafe;
    },
  }),
};
