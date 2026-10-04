import { pathScopeAudit } from '@lobechat/builtin-tool-local-system';
import { type DynamicInterventionResolver } from '@lobechat/types';

export const dynamicInterventionAudits: Record<string, DynamicInterventionResolver> = {
  pathScopeAudit,
};
