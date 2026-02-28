import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { ActivatedToolInfo, ActivateToolsParams } from '../types';

export interface ToolManifestInfo {
  apiDescriptions: Array<{ description: string; name: string }>;
  avatar?: string;
  identifier: string;
  name: string;
  systemRole?: string;
}

export interface ToolsActivatorRuntimeService {
  getActivatedToolIds: () => string[];
  getToolManifests: (identifiers: string[]) => Promise<ToolManifestInfo[]>;
  markActivated: (identifiers: string[]) => void;
}

export interface ToolsActivatorExecutionRuntimeOptions {
  service: ToolsActivatorRuntimeService;
}

export class ToolsActivatorExecutionRuntime {
  private service: ToolsActivatorRuntimeService;

  constructor(options: ToolsActivatorExecutionRuntimeOptions) {
    this.service = options.service;
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
      const notFound = toActivate.filter((id) => !foundIdentifiers.has(id));

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
        parts.push('Successfully activated tools:');
        for (const manifest of manifests) {
          parts.push(`\n## ${manifest.name} (${manifest.identifier})`);
          if (manifest.systemRole) {
            parts.push(manifest.systemRole);
          }
          if (manifest.apiDescriptions.length > 0) {
            parts.push('\nAvailable APIs:');
            for (const api of manifest.apiDescriptions) {
              parts.push(`- **${api.name}**: ${api.description}`);
            }
          }
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
