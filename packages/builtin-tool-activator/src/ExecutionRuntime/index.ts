import type {
  BuiltinServerRuntimeOutput,
  OnDemandCapabilityExpectation,
  OnDemandCapabilitySource,
  OnDemandExecutionEnvironment,
} from '@lobechat/types';

import type { ActivatedToolInfo, ActivateSkillParams, ActivateToolsParams } from '../types';

export interface ToolManifestInfo {
  apiDescriptions: Array<{ description: string; name: string }>;
  avatar?: string;
  capability?: OnDemandCapabilityExpectation;
  capabilitySummary?: string;
  executionEnvironment?: OnDemandExecutionEnvironment;
  identifier: string;
  /** Full, untruncated atomic manual. Present only for on-demand activations. */
  manual?: string;
  name: string;
  source?: OnDemandCapabilitySource;
  systemRole?: string;
  version?: string;
}

export interface ActivatorRuntimeService {
  activateSkill?: (args: ActivateSkillParams) => Promise<BuiltinServerRuntimeOutput>;
  getActivatedToolIds: () => string[];
  getToolManifests: (identifiers: string[]) => Promise<ToolManifestInfo[]>;
  /** Whether this runtime is executing the on-demand activation contract. */
  isOnDemand?: () => boolean;
  markActivated: (identifiers: string[]) => void;
}

export interface ActivatorExecutionRuntimeOptions {
  service: ActivatorRuntimeService;
}

export class ActivatorExecutionRuntime {
  private service: ActivatorRuntimeService;

  constructor(options: ActivatorExecutionRuntimeOptions) {
    this.service = options.service;
  }

  async activateSkill(args: ActivateSkillParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.service.activateSkill) {
      return {
        content: 'Skill activation is not available.',
        success: false,
      };
    }

    return this.service.activateSkill(args);
  }

  async activateTools(args: ActivateToolsParams): Promise<BuiltinServerRuntimeOutput> {
    const { identifiers } = args;

    if (!identifiers || identifiers.length === 0) {
      return {
        content: 'No tool identifiers provided. Please specify which tools to activate.',
        success: false,
      };
    }

    try {
      const alreadyActive = this.service.getActivatedToolIds();
      const toActivate: string[] = [];
      const alreadyActiveList: string[] = [];

      for (const id of identifiers) {
        if (alreadyActive.includes(id)) {
          alreadyActiveList.push(id);
        } else {
          toActivate.push(id);
        }
      }

      // Fetch manifests for tools to activate
      const manifests = await this.service.getToolManifests(toActivate);

      const foundIdentifiers = new Set(manifests.map((m) => m.identifier));
      const notFoundAsTools = toActivate.filter((id) => !foundIdentifiers.has(id));

      // Fallback: try activating not-found identifiers as skills
      const activatedSkillResults: BuiltinServerRuntimeOutput[] = [];
      const notFound: string[] = [];

      if (notFoundAsTools.length > 0 && this.service.activateSkill) {
        for (const id of notFoundAsTools) {
          try {
            const skillResult = await this.service.activateSkill({ name: id });
            if (skillResult.success) {
              activatedSkillResults.push(skillResult);
            } else {
              notFound.push(id);
            }
          } catch {
            notFound.push(id);
          }
        }
      } else {
        notFound.push(...notFoundAsTools);
      }

      const activatedTools: ActivatedToolInfo[] = manifests.map((m) => ({
        apiCount: m.apiDescriptions.length,
        avatar: m.avatar,
        capability: m.capability,
        capabilitySummary: m.capabilitySummary,
        executionEnvironment: m.executionEnvironment,
        hash: m.capability?.hash,
        identifier: m.identifier,
        name: m.name,
        source: m.source,
        version: m.capability?.version,
      }));
      const isOnDemandActivation = manifests.some((manifest) => !!manifest.capability);

      // Mark newly activated tools
      if (manifests.length > 0) {
        this.service.markActivated(manifests.map((m) => m.identifier));
      }

      // Build response content
      const parts: string[] = [];

      if (activatedTools.length > 0) {
        const apiNames = manifests.flatMap((manifest) =>
          manifest.apiDescriptions.length > 0
            ? manifest.apiDescriptions.map((api) => `${manifest.identifier}.${api.name}`)
            : [manifest.identifier],
        );
        parts.push(`Successfully activated tools: ${apiNames.join(', ')}.`);

        if (isOnDemandActivation) {
          // In on-demand mode the tool result is the only durable manual
          // channel. Append each validated manual in full; the context engine's
          // legacy trim processor is bypassed in this mode.
          for (const manifest of manifests) {
            if (manifest.manual) parts.push(manifest.manual);
          }
        } else {
          // Legacy activation state is injected into the system prompt on the
          // next call, so keep the historical terse result unchanged.
          parts.push('Usage instructions for the activated items are in the system prompt.');
        }
      }

      if (activatedSkillResults.length > 0) {
        for (const skillResult of activatedSkillResults) {
          parts.push(skillResult.content);
        }
      }

      if (alreadyActiveList.length > 0) {
        parts.push(`\nAlready active: ${alreadyActiveList.join(', ')}`);
      }

      if (notFound.length > 0) {
        parts.push(`\nNot found: ${notFound.join(', ')}`);
      }

      const isOnDemandRejected =
        this.service.isOnDemand?.() === true &&
        manifests.length === 0 &&
        activatedSkillResults.length === 0 &&
        notFound.length > 0 &&
        identifiers.every((id) => notFound.includes(id));

      return {
        content: parts.join('\n'),
        state: {
          activatedSkills: activatedSkillResults.map((r) => r.state),
          activatedTools,
          alreadyActive: alreadyActiveList,
          notFound,
        },
        success: !isOnDemandRejected,
      };
    } catch (e) {
      return {
        content: `Failed to activate tools: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
