import { LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { SkillsManifest } from '@lobechat/builtin-tool-skills';
import type { BuiltinToolManifest, OnDemandBootstrapIdentifier } from '@lobechat/types';
import { ON_DEMAND_BOOTSTRAP_ALLOWLIST, ON_DEMAND_BOOTSTRAP_IDENTIFIERS } from '@lobechat/types';

const NATIVE_MANIFESTS: Readonly<Record<OnDemandBootstrapIdentifier, BuiltinToolManifest>> = {
  'lobe-activator': LobeActivatorManifest,
  'lobe-agent-documents': AgentDocumentsManifest,
  'lobe-skills': SkillsManifest,
};

const createRestrictedManifest = (identifier: OnDemandBootstrapIdentifier): BuiltinToolManifest => {
  const native = NATIVE_MANIFESTS[identifier];
  const allowedApiNames = ON_DEMAND_BOOTSTRAP_ALLOWLIST[identifier];
  const api = allowedApiNames.map((apiName) => {
    const nativeApi = native.api.find((item) => item.name === apiName);
    if (!nativeApi) {
      throw new Error(`Native bootstrap API not found: ${identifier}.${apiName}`);
    }

    return nativeApi;
  });

  return {
    ...native,
    api,
    // The stable protocol owns the bootstrap instructions; native manuals are
    // loaded atomically with the capability instead of entering the prefix.
    systemRole: '',
  };
};

/**
 * Real builtin manifests restricted to the exact bootstrap APIs. API objects
 * are the native schemas, including their human-intervention/render metadata.
 */
export const ON_DEMAND_BOOTSTRAP_MANIFESTS = Object.freeze(
  ON_DEMAND_BOOTSTRAP_IDENTIFIERS.map((identifier) =>
    Object.freeze(createRestrictedManifest(identifier)),
  ),
);

export const ON_DEMAND_BOOTSTRAP_MANIFESTS_BY_IDENTIFIER = Object.freeze(
  Object.fromEntries(
    ON_DEMAND_BOOTSTRAP_MANIFESTS.map((manifest) => [manifest.identifier, manifest]),
  ) as Record<OnDemandBootstrapIdentifier, BuiltinToolManifest>,
);
