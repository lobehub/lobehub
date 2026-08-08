import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { ActivatedToolInfo, ActivateSkillParams, ActivateToolsParams } from '../types';

export interface ToolManifestInfo {
  apiDescriptions: Array<{ description: string; name: string }>;
  avatar?: string;
  identifier: string;
  name: string;
  systemRole?: string;
}

export interface ActivatorRuntimeService {
  activateSkill?: (args: ActivateSkillParams) => Promise<BuiltinServerRuntimeOutput>;
  getActivatedToolIds: () => string[];
  getToolManifests: (identifiers: string[]) => Promise<ToolManifestInfo[]>;
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
        identifier: m.identifier,
        name: m.name,
      }));

      // Mark newly activated tools
      if (manifests.length > 0) {
        this.service.markActivated(manifests.map((m) => m.identifier));
      }

      // Build response content
      const parts: string[] = [];

      if (activatedTools.length > 0) {
        // Activation state flows through `state.activatedTools` and gets the
        // manifest (systemRole + API schemas) injected into the system prompt
        // from the next LLM call onwards, so the result only needs to list the
        // newly callable APIs — returning the full docs here would double-carry
        // them in every subsequent payload (LOBE-5684).
        const apiNames = manifests.flatMap((manifest) =>
          manifest.apiDescriptions.length > 0
            ? manifest.apiDescriptions.map((api) => `${manifest.identifier}.${api.name}`)
            : [manifest.identifier],
        );
        parts.push(`Successfully activated tools: ${apiNames.join(', ')}.`);
        parts.push('Usage instructions for the activated items are in the system prompt.');
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

      return {
        content: parts.join('\n'),
        state: {
          activatedSkills: activatedSkillResults.map((r) => r.state),
          activatedTools,
          alreadyActive: alreadyActiveList,
          notFound,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to activate tools: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
