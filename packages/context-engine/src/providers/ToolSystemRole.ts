import type { API, Tool } from '@lobechat/prompts';
import { pluginPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import { ToolNameResolver } from '../engine/tools';
import type { LobeToolManifest } from '../engine/tools/types';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:ToolSystemRoleProvider');

/**
 * Tool System Role Configuration
 */
export interface ToolSystemRoleConfig {
  /** Function to check if function calling is supported */
  isCanUseFC: (model: string, provider: string) => boolean | undefined;
  /** Tool manifests with systemRole and API definitions */
  manifests: LobeToolManifest[];
  /** Model name */
  model: string;
  /** Provider name */
  provider: string;
}

/**
 * Tool System Role Provider
 * Responsible for injecting tool-related system roles for models that support tool calling
 */
export class ToolSystemRoleProvider extends BaseProvider {
  readonly name = 'ToolSystemRoleProvider';

  private toolNameResolver: ToolNameResolver;

  constructor(
    private config: ToolSystemRoleConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
    this.toolNameResolver = new ToolNameResolver();
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Check tool-related conditions
    const toolSystemRole = this.getToolSystemRole();

    if (!toolSystemRole) {
      log('No need to inject tool system role, skipping processing');
      return this.markAsExecuted(clonedContext);
    }

    // Inject tool system role
    this.injectToolSystemRole(clonedContext, toolSystemRole);

    // Update metadata
    clonedContext.metadata.toolSystemRole = {
      contentLength: toolSystemRole.length,
      injected: true,
      supportsFunctionCall: this.config.isCanUseFC(this.config.model, this.config.provider),
      toolsCount: this.config.manifests.length,
    };

    log(`Tool system role injection completed, tools count: ${this.config.manifests.length}`);
    return this.markAsExecuted(clonedContext);
  }

  /**
   * Get tool system role content
   */
  private getToolSystemRole(): string | undefined {
    const { manifests, model, provider } = this.config;

    // Check if manifests are available
    if (!manifests || manifests.length === 0) {
      log('No available tool manifests');
      return undefined;
    }

    // Check if function calling is supported
    const hasFC = this.config.isCanUseFC(model, provider);
    if (!hasFC) {
      log(`Model ${model} (${provider}) does not support function calling`);
      return undefined;
    }

    // Transform manifests to Tool[] format for pluginPrompts
    // Only include manifests that have APIs or systemRole
    const tools: Tool[] = manifests
      .filter((manifest) => manifest.api.length > 0 || manifest.systemRole)
      .map((manifest) => ({
        apis: manifest.api.map(
          (api): API => ({
            desc: api.description,
            name: this.toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
          }),
        ),
        identifier: manifest.identifier,
        name: manifest.meta?.title || manifest.identifier,
        systemRole: manifest.systemRole,
      }));

    // Skip if no meaningful tools after filtering
    if (tools.length === 0) {
      log('No meaningful tools to inject (all manifests have empty APIs and no systemRole)');
      return undefined;
    }

    // Generate tool system role using pluginPrompts
    const toolSystemRole = pluginPrompts({ tools });

    if (!toolSystemRole) {
      log('Failed to generate tool system role content');
      return undefined;
    }

    log(`Generated tool system role for ${manifests.length} tools`);
    return toolSystemRole;
  }

  /**
   * Inject tool system role
   */
  private injectToolSystemRole(context: PipelineContext, toolSystemRole: string): void {
    const existingSystemMessage = context.messages.find((msg) => msg.role === 'system');

    if (existingSystemMessage) {
      // Merge to existing system message
      existingSystemMessage.content = [existingSystemMessage.content, toolSystemRole]
        .filter(Boolean)
        .join('\n\n');

      log(
        `Tool system role merged to existing system message, final length: ${existingSystemMessage.content.length}`,
      );
    } else {
      context.messages.unshift({
        content: toolSystemRole,
        id: `tool-system-role-${Date.now()}`,
        role: 'system' as const,
      } as any);
      log(`New tool system message created, content length: ${toolSystemRole.length}`);
    }
  }
}
