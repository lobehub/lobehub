import debug from 'debug';

import type {
  FunctionCallChecker,
  GenerateToolsParams,
  LobeToolManifest,
  PluginEnableChecker,
  ToolsEngineOptions,
  ToolsGenerationContext,
  ToolsGenerationResult,
  UniformTool,
} from './types';
import { generateToolName } from './utils';

const log = debug('context-engine:tools-engine');

/**
 * Tools Engine - Unified processing of tools array construction and transformation
 */
export class ToolsEngine {
  private manifestSchemas: Map<string, LobeToolManifest>;
  private enableChecker?: PluginEnableChecker;
  private functionCallChecker?: FunctionCallChecker;
  private defaultToolIds: string[];
  private options: ToolsEngineOptions;

  constructor(options: ToolsEngineOptions) {
    this.options = options;
    this.defaultToolIds = options.defaultToolIds || [];
    log(
      'Initializing ToolsEngine with %d manifest schemas and %d default tools',
      options.manifestSchemas.length,
      this.defaultToolIds.length,
    );

    // Convert manifest schemas to Map for improved lookup performance
    this.manifestSchemas = new Map(
      options.manifestSchemas.map((schema) => [schema.identifier, schema]),
    );
    this.enableChecker = options.enableChecker;
    this.functionCallChecker = options.functionCallChecker;

    log(
      'ToolsEngine initialized with plugins: %o, default tools: %o',
      Array.from(this.manifestSchemas.keys()),
      this.defaultToolIds,
    );
  }

  /**
   * Generate tools array
   * @param params Tools generation parameters
   * @returns Processed tools array, or undefined if tools should not be enabled
   */
  generateTools(params: GenerateToolsParams): UniformTool[] | undefined {
    const { toolIds = [], model, provider, context, skipDefaultTools } = params;

    // Merge user-provided tool IDs with default tool IDs (unless skipDefaultTools is true)
    const allToolIds = skipDefaultTools
      ? toolIds
      : [...new Set([...toolIds, ...this.defaultToolIds])];

    log(
      'Generating tools for model=%s, provider=%s, pluginIds=%o (skipDefaultTools=%s, includes %d default tools)',
      model,
      provider,
      allToolIds,
      skipDefaultTools,
      skipDefaultTools ? 0 : this.defaultToolIds.length,
    );

    // 1. Check if model supports Function Calling
    if (!this.checkFunctionCallSupport(model, provider)) {
      log('Function calling not supported for model=%s, provider=%s', model, provider);
      return undefined;
    }

    // 2. Filter and validate plugins
    const { enabledManifests } = this.filterEnabledPlugins(allToolIds, model, provider, context);

    // 3. If no tools available, return undefined
    if (enabledManifests.length === 0) {
      log('No enabled manifests found, returning undefined');
      return undefined;
    }

    // 4. Convert to UniformTool format
    const tools = this.convertManifestsToTools(enabledManifests);
    log('Generated %d tools from %d manifests', tools.length, enabledManifests.length);

    return tools;
  }

  /**
   * Generate tools array (detailed version)
   * @param params Tools generation parameters
   * @returns Detailed tools generation result
   */
  generateToolsDetailed(params: GenerateToolsParams): ToolsGenerationResult {
    const { toolIds = [], model, provider, context, skipDefaultTools } = params;

    // Merge user-provided tool IDs with default tool IDs and deduplicate (unless skipDefaultTools is true)
    const allToolIds = skipDefaultTools
      ? toolIds
      : [...new Set([...toolIds, ...this.defaultToolIds])];

    log(
      'Generating detailed tools for model=%s, provider=%s, pluginIds=%o (skipDefaultTools=%s, includes %d default tools)',
      model,
      provider,
      allToolIds,
      skipDefaultTools,
      skipDefaultTools ? 0 : this.defaultToolIds.length,
    );

    // Check if model supports Function Calling
    const supportsFunctionCall = this.checkFunctionCallSupport(model, provider);

    // Filter and validate plugins with FC support information
    const { enabledManifests, filteredPlugins } = this.filterEnabledPlugins(
      allToolIds,
      model,
      provider,
      context,
      supportsFunctionCall,
    );

    // Convert to UniformTool format only if there are enabled manifests
    const tools =
      enabledManifests.length > 0 ? this.convertManifestsToTools(enabledManifests) : undefined;

    log(
      'Generated detailed result: enabled=%d, filtered=%d, tools=%d',
      enabledManifests.length,
      filteredPlugins.length,
      tools?.length ?? 0,
    );

    return {
      enabledManifests,
      enabledToolIds: enabledManifests.map((m) => m.identifier),
      filteredTools: filteredPlugins,
      tools,
    };
  }

  /**
   * Check if model supports Function Calling
   */
  private checkFunctionCallSupport(model: string, provider: string): boolean {
    if (this.functionCallChecker) {
      const result = this.functionCallChecker(model, provider);
      log('Function calling check result for %s/%s: %s', model, provider, result);
      return result;
    }

    // Default to assuming Function Calling is supported
    log('No function calling checker provided, defaulting to true');
    return true;
  }

  /**
   * Filter enabled plugins
   */
  private filterEnabledPlugins(
    pluginIds: string[],
    model: string,
    provider: string,
    context?: ToolsGenerationContext,
    supportsFunctionCall?: boolean,
  ): {
    enabledManifests: LobeToolManifest[];
    filteredPlugins: Array<{
      id: string;
      reason: 'not_found' | 'disabled' | 'incompatible';
    }>;
  } {
    const enabledManifests: LobeToolManifest[] = [];
    const filteredPlugins: Array<{
      id: string;
      reason: 'not_found' | 'disabled' | 'incompatible';
    }> = [];

    log('Filtering plugins: %o', pluginIds);

    // If function calling is not supported, filter all plugins as incompatible
    if (supportsFunctionCall === false) {
      for (const pluginId of pluginIds) {
        const manifest = this.manifestSchemas.get(pluginId);
        if (!manifest) {
          log('Plugin not found: %s', pluginId);
          filteredPlugins.push({ id: pluginId, reason: 'not_found' });
        } else {
          log('Plugin incompatible (no FC support): %s', pluginId);
          filteredPlugins.push({ id: pluginId, reason: 'incompatible' });
        }
      }
      log('Filtering complete: enabled=%d, filtered=%d', 0, filteredPlugins.length);
      return { enabledManifests, filteredPlugins };
    }

    for (const pluginId of pluginIds) {
      const manifest = this.manifestSchemas.get(pluginId);

      if (!manifest) {
        log('Plugin not found: %s', pluginId);
        filteredPlugins.push({ id: pluginId, reason: 'not_found' });
        continue;
      }

      // Use injected checker function or default check logic
      const isEnabled = this.enableChecker
        ? this.enableChecker({
            context,
            manifest,
            model,
            pluginId,
            provider,
          })
        : this.defaultEnabledCheck();

      if (isEnabled) {
        log('Plugin enabled: %s', pluginId);
        enabledManifests.push(manifest);
      } else {
        log('Plugin disabled: %s', pluginId);
        filteredPlugins.push({ id: pluginId, reason: 'disabled' });
      }
    }

    log(
      'Filtering complete: enabled=%d, filtered=%d',
      enabledManifests.length,
      filteredPlugins.length,
    );
    return { enabledManifests, filteredPlugins };
  }

  /**
   * Default enabled check logic
   */
  private defaultEnabledCheck(): boolean {
    // Default to enabling all tools
    return true;
  }

  /**
   * Convert manifests to UniformTool array
   */
  private convertManifestsToTools(manifests: LobeToolManifest[]): UniformTool[] {
    log('Converting %d manifests to tools', manifests.length);

    // Use simplified conversion logic to avoid external package dependencies
    const tools = manifests.flatMap((manifest) =>
      manifest.api.map((api) => ({
        function: {
          description: api.description,
          name: this.generateToolName(manifest.identifier, api.name, manifest.type),
          parameters: api.parameters,
        },
        type: 'function' as const,
      })),
    );

    log('Converted to %d tools', tools.length);
    return tools;
  }

  /**
   * Generate tool calling name
   * Uses external generator if provided, otherwise uses default logic from utils
   */
  private generateToolName(identifier: string, apiName: string, type?: string): string {
    // If external name generator is provided, use it
    if (this.options.generateToolName) {
      return this.options.generateToolName(identifier, apiName, type);
    }

    // Use default tool name generation logic from utils
    return generateToolName(identifier, apiName, type);
  }

  /**
   * Get available plugin list (for debugging and monitoring)
   */
  getAvailablePlugins(): string[] {
    return Array.from(this.manifestSchemas.keys());
  }

  /**
   * Check if a specific plugin is available
   */
  hasPlugin(pluginId: string): boolean {
    return this.manifestSchemas.has(pluginId);
  }

  /**
   * Get plugin manifest
   */
  getPluginManifest(pluginId: string): LobeToolManifest | undefined {
    return this.manifestSchemas.get(pluginId);
  }

  /**
   * Update plugin manifest schemas (for dynamically adding plugins)
   */
  updateManifestSchemas(manifestSchemas: LobeToolManifest[]): void {
    this.manifestSchemas.clear();
    for (const schema of manifestSchemas) {
      this.manifestSchemas.set(schema.identifier, schema);
    }
  }

  /**
   * Add a single plugin manifest
   */
  addPluginManifest(manifest: LobeToolManifest): void {
    this.manifestSchemas.set(manifest.identifier, manifest);
  }

  /**
   * Remove plugin manifest
   */
  removePluginManifest(pluginId: string): boolean {
    return this.manifestSchemas.delete(pluginId);
  }

  /**
   * Get Manifest Map of all enabled plugins
   */
  getEnabledPluginManifests(toolIds: string[] = []): Map<string, LobeToolManifest> {
    // Merge user-provided tool IDs with default tool IDs
    const allToolIds = [...toolIds, ...this.defaultToolIds];

    log('Getting enabled plugin manifests for pluginIds=%o', allToolIds);

    const manifestMap = new Map<string, LobeToolManifest>();

    for (const pluginId of allToolIds) {
      const manifest = this.manifestSchemas.get(pluginId);
      if (manifest) {
        manifestMap.set(pluginId, manifest);
      }
    }

    log('Returning %d enabled plugin manifests', manifestMap.size);
    return manifestMap;
  }

  /**
   * Get Manifest Map of all plugins
   */
  getAllPluginManifests(): Map<string, LobeToolManifest> {
    return new Map(this.manifestSchemas);
  }
}
