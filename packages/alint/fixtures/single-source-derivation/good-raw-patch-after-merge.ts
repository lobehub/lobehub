// Fixture: after merging, the code reads the raw patch on purpose — it needs what the
// caller sent, not the effective value (database/models/agent.ts, updateConfig).
import { merge } from 'lodash-es';

interface AgentConfig {
  agencyConfig?: { apiConfig?: { providerId?: string; source?: string } } | null;
  systemRole?: string;
}

export const applyAgentConfigPatch = (agent: AgentConfig, patch: Partial<AgentConfig>) => {
  const mergedValue: AgentConfig = merge({}, agent, patch);

  // A user-provider patch clears the discriminator kept from a previous server-default
  // binding. Whether to clear depends on what this patch carries, not on the merge.
  const apiConfigPatch = patch.agencyConfig?.apiConfig;
  const mergedApiConfig = mergedValue.agencyConfig?.apiConfig;
  if (
    apiConfigPatch &&
    apiConfigPatch.source !== 'server-default' &&
    typeof apiConfigPatch.providerId === 'string' &&
    mergedApiConfig
  ) {
    delete mergedApiConfig.source;
  }

  return mergedValue;
};
