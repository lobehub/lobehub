import {
  AgentBuilderInterventions,
  AgentBuilderManifest,
} from '@lobechat/builtin-tool-agent-builder/client';
import {
  ClaudeCodeIdentifier,
  ClaudeCodeInterventions,
} from '@lobechat/builtin-tool-claude-code/client';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { CloudSandboxInterventions } from '@lobechat/builtin-tool-cloud-sandbox/client';
import {
  GroupManagementInterventions,
  GroupManagementManifest,
} from '@lobechat/builtin-tool-group-management/client';
import { GTDInterventions, GTDManifest } from '@lobechat/builtin-tool-gtd/client';
import {
  LocalSystemIdentifier,
  LocalSystemInterventions,
} from '@lobechat/builtin-tool-local-system/client';
import { MemoryInterventions, MemoryManifest } from '@lobechat/builtin-tool-memory/client';
import { MessageInterventions, MessageManifest } from '@lobechat/builtin-tool-message/client';
import {
  UserInteractionIdentifier,
  UserInteractionInterventions,
} from '@lobechat/builtin-tool-user-interaction/client';
import {
  WebOnboardingInterventions,
  WebOnboardingManifest,
} from '@lobechat/builtin-tool-web-onboarding/client';
import { type BuiltinIntervention } from '@lobechat/types';

/**
 * Builtin tools interventions registry
 * Organized by toolset (identifier) -> API name
 * Only register APIs that have custom intervention UI
 */
export const BuiltinToolInterventions: Record<string, Record<string, any>> = {
  [AgentBuilderManifest.identifier]: AgentBuilderInterventions,
  [ClaudeCodeIdentifier]: ClaudeCodeInterventions,
  [CloudSandboxManifest.identifier]: CloudSandboxInterventions,
  [GroupManagementManifest.identifier]: GroupManagementInterventions,
  [GTDManifest.identifier]: GTDInterventions,
  [LocalSystemIdentifier]: LocalSystemInterventions,
  [MemoryManifest.identifier]: MemoryInterventions,
  [MessageManifest.identifier]: MessageInterventions,
  [UserInteractionIdentifier]: UserInteractionInterventions,
  [WebOnboardingManifest.identifier]: WebOnboardingInterventions,
};

export interface BuiltinInterventionRegistryEntry {
  apiName: string;
  identifier: string;
  intervention: BuiltinIntervention;
}

export const listBuiltinInterventionEntries = (): BuiltinInterventionRegistryEntry[] =>
  Object.entries(BuiltinToolInterventions).flatMap(([identifier, toolset]) =>
    Object.entries(toolset)
      .filter((entry): entry is [string, BuiltinIntervention] => !!entry[1])
      .map(([apiName, intervention]) => ({
        apiName,
        identifier,
        intervention,
      })),
  );

/**
 * Get builtin intervention component for a specific API
 * @param identifier - Tool identifier (e.g., 'lobe-local-system')
 * @param apiName - API name (e.g., 'runCommand')
 */
export const getBuiltinIntervention = (
  identifier?: string,
  apiName?: string,
): BuiltinIntervention | undefined => {
  if (!identifier || !apiName) return undefined;

  const toolset = BuiltinToolInterventions[identifier];
  if (!toolset) return undefined;

  return toolset[apiName];
};
