import type { LobeToolManifest, PluginEnableChecker, ToolsGenerationContext } from './types';

export interface EnableCheckerConfig {
  /**
   * Whether to allow isExplicitActivation bypass.
   * When true, tools with `context.isExplicitActivation` skip all filters.
   */
  allowExplicitActivation?: boolean;

  /**
   * Platform-specific filter extension point.
   * Return `true` to enable, `false` to disable, or `undefined` to fall through to rules.
   */
  platformFilter?: (params: {
    context?: ToolsGenerationContext;
    manifest: LobeToolManifest;
    pluginId: string;
  }) => boolean | undefined;

  /**
   * Tool-specific enable rules, keyed by pluginId.
   * If a pluginId is present in this map, its value determines whether the tool is enabled.
   * If not present, the tool is disabled by default.
   */
  rules?: Record<string, boolean>;
}

/**
 * Create a unified PluginEnableChecker from declarative configuration.
 *
 * Both frontend and server should use this factory to ensure consistent
 * enable/disable logic. Platform-specific filters can be injected via
 * the `platformFilter` extension point.
 */
export function createEnableChecker(config: EnableCheckerConfig): PluginEnableChecker {
  return ({ pluginId, context, manifest }) => {
    // 1. Explicit activation bypass (e.g. tools activated via lobe-activator)
    if (config.allowExplicitActivation && context?.isExplicitActivation) return true;

    // 2. Platform-specific filter (return undefined = fall through)
    const platformResult = config.platformFilter?.({ context, manifest, pluginId });
    if (platformResult !== undefined) return platformResult;

    // 3. Tool-specific rules
    if (config.rules && pluginId in config.rules) {
      return config.rules[pluginId];
    }

    // 4. Default: disabled (tools must be explicitly enabled via rules)
    return false;
  };
}
