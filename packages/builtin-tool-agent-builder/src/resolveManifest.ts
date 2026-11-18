import type { BuiltinManifestResolver } from '@lobechat/types';

import { AgentBuilderManifest } from './manifest';
import { selfConfigurationSystemPrompt } from './systemRole';
import { AgentBuilderApiName } from './types';

/** Marketplace installs need a person to approve them, which a self-configuring run may not have. */
const SELF_CONFIGURATION_APIS = new Set<string>([
  AgentBuilderApiName.getAvailableModels,
  AgentBuilderApiName.updateAgentConfig,
  AgentBuilderApiName.updatePrompt,
]);

/**
 * Context-aware manifest for the agent builder tool.
 *
 * By default the builder is a separate configuration assistant that edits another agent. When the
 * run edits itself (`isSelfConfiguration`), it gets a short prompt that addresses the agent about
 * its own settings and keeps it in its own role, plus the APIs that need no approval.
 */
export const resolveAgentBuilderManifest: BuiltinManifestResolver = (context) => {
  if (context.isSelfConfiguration !== true) return AgentBuilderManifest;

  return {
    ...AgentBuilderManifest,
    api: AgentBuilderManifest.api.filter((api) => SELF_CONFIGURATION_APIS.has(api.name)),
    systemRole: selfConfigurationSystemPrompt,
  };
};
