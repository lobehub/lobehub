import { credsSecureInputAudit } from '@lobechat/builtin-tool-creds';
import { pathScopeAudit } from '@lobechat/builtin-tool-local-system';
import { type DynamicInterventionResolver } from '@lobechat/types';

export const dynamicInterventionAudits: Record<string, DynamicInterventionResolver> = {
  credsSecureInput: credsSecureInputAudit,
  pathScopeAudit,
};
