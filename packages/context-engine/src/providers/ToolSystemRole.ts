import type { API, Tool } from '@lobechat/prompts';
import { pluginPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import { ToolNameResolver } from '../engine/tools';
import type { LobeToolManifest } from '../engine/tools/types';
import type { PipelineContext, ProcessorOptions } from '../types';
import { collectActivatedToolIds } from '../utils/activatedTools';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    toolSystemRole?: {
      contentLength: number;
      injected: boolean;
      supportsFunctionCall: boolean;
      toolsCount: number;
    };
  }
}

const log = debug('context-engine:provider:ToolSystemRoleProvider');

/**
 * Tool System Role Configuration
 */
export interface ToolSystemRoleConfig {
  /**
   * Leave a tool out of the system message while the `activateTools` result that
   * activated it is part of the request. ToolActivationAnchorProcessor appends its
   * instructions to that result instead, so activating a tool mid-conversation does
   * not rewrite the system message (and the prompt cache behind it).
   */
  anchorActivatedTools?: boolean;
  enabled?: boolean;
  /** Function to check if function calling is supported */
  isCanUseFC: (model: string, provider: string) => boolean | undefined;
  /** Tool manifests with systemRole and API definitions */
  manifests?: LobeToolManifest[];
  /** Model name */
  model: string;
  /** Provider name */
  provider: string;
}

/**
 * Select the manifests whose systemRole / API descriptions get injected into the
 * system prompt by ToolSystemRoleProvider.
 *
 * Exported so ActivationResultTrimProcessor can decide, with the exact same
 * predicate, whether an activation tool result's full documentation is already
 * carried by the system prompt and can therefore be trimmed from history.
 */
export const selectToolPromptManifests = (manifests?: LobeToolManifest[]): LobeToolManifest[] =>
  (manifests ?? []).filter((manifest) => manifest.api.length > 0 || manifest.systemRole);

/** The prompt entry a manifest contributes to the tool instructions. */
export const toToolPrompt = (manifest: LobeToolManifest): Tool => {
  const toolNameResolver = new ToolNameResolver();

  return {
    apis: manifest.api.map((api): API => ({
      desc: api.description,
      name: toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
    })),
    description: manifest.meta?.description,
    identifier: manifest.identifier,
    name: manifest.meta?.title || manifest.identifier,
    systemRole: manifest.systemRole,
  };
};

/**
 * Tool System Role Provider
 * Responsible for injecting tool-related system roles for models that support tool calling
 */
export class ToolSystemRoleProvider extends BaseSystemRoleProvider {
  readonly name = 'ToolSystemRoleProvider';

  /** Tools whose instructions stay with their activation result for this request. */
  private anchoredToolIds = new Set<string>();

  constructor(
    private config: ToolSystemRoleConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    this.anchoredToolIds = this.resolveAnchoredToolIds(context);

    const processed = await super.doProcess(context);
    if (this.anchoredToolIds.size === 0) return processed;

    return {
      ...processed,
      metadata: {
        ...processed.metadata,
        toolActivationAnchors: { toolIds: [...this.anchoredToolIds] },
      },
    };
  }

  /**
   * Only tools this provider would otherwise inject are anchored, so nothing is
   * relocated when the provider is off or the model cannot call functions.
   */
  private resolveAnchoredToolIds(context: PipelineContext): Set<string> {
    const { anchorActivatedTools, enabled, manifests, model, provider } = this.config;
    if (!anchorActivatedTools || enabled === false || !manifests?.length) return new Set();
    if (!this.config.isCanUseFC(model, provider)) return new Set();

    const injectable = new Set(selectToolPromptManifests(manifests).map((m) => m.identifier));
    return new Set(collectActivatedToolIds(context.messages).filter((id) => injectable.has(id)));
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    const toolSystemRole = this.getToolSystemRole();

    if (!toolSystemRole) {
      log('No need to inject tool system role, skipping processing');
      return null;
    }

    log(`Tool system role injection completed, tools count: ${this.config.manifests?.length ?? 0}`);
    return toolSystemRole;
  }

  protected onInjected(context: PipelineContext, content: string): void {
    context.metadata.toolSystemRole = {
      contentLength: content.length,
      injected: true,
      supportsFunctionCall: !!this.config.isCanUseFC(this.config.model, this.config.provider),
      toolsCount: this.config.manifests?.length ?? 0,
    };
  }

  /**
   * Get tool system role content
   */
  private getToolSystemRole(): string | undefined {
    const { manifests, model, provider } = this.config;

    if (!manifests || manifests.length === 0) {
      log('No available tool manifests');
      return undefined;
    }

    const hasFC = this.config.isCanUseFC(model, provider);
    if (!hasFC) {
      log(`Model ${model} (${provider}) does not support function calling`);
      return undefined;
    }

    const tools: Tool[] = selectToolPromptManifests(manifests)
      .filter((manifest) => !this.anchoredToolIds.has(manifest.identifier))
      .map((manifest) => toToolPrompt(manifest));

    if (tools.length === 0) {
      log('No meaningful tools to inject (all manifests have empty APIs and no systemRole)');
      return undefined;
    }

    const toolSystemRole = pluginPrompts({ tools });

    if (!toolSystemRole) {
      log('Failed to generate tool system role content');
      return undefined;
    }

    log(`Generated tool system role for ${manifests.length} tools`);
    return toolSystemRole;
  }
}
