import type { HumanInterventionConfig } from '@lobechat/types';

export interface LobeChatPluginApi {
  description: string;
  /**
   * Human intervention configuration
   * Controls when and how the tool requires human approval/selection
   *
   * Can be either:
   * - Simple: A policy string ('never', 'always', 'first')
   * - Complex: Array of rules for parameter-level control
   *
   * Examples:
   * - 'always' - always require intervention
   * - [{ match: { command: "git add:*" }, policy: "never" }, { policy: "always" }]
   */
  humanIntervention?: HumanInterventionConfig;
  name: string;
  parameters: Record<string, any>;
  url?: string;
}

export interface LobeToolManifest {
  api: LobeChatPluginApi[];
  identifier: string;
  meta: any;
  systemRole?: string;
  type?: 'default' | 'standalone' | 'markdown' | 'mcp' | 'builtin';
}

/**
 * Tools generation context
 */
export interface ToolsGenerationContext {
  /** Additional extension context */
  [key: string]: any;
  /** Whether image generation is allowed */
  allowImageGeneration?: boolean;
  /** Environment information */
  environment?: 'desktop' | 'web';
  /** Whether search is enabled */
  isSearchEnabled?: boolean;
  /** Model name for context-aware plugin filtering */
  model?: string;
  /** Provider name for context-aware plugin filtering */
  provider?: string;
}

/**
 * Plugin enable checker function
 */
export type PluginEnableChecker = (params: {
  context?: ToolsGenerationContext;
  manifest: LobeToolManifest;
  model: string;
  pluginId: string;
  provider: string;
}) => boolean;

/**
 * Function calling support checker function
 */
export type FunctionCallChecker = (model: string, provider: string) => boolean;

/**
 * Tools generation parameters
 */
export interface GenerateToolsParams {
  /** Additional context information */
  context?: ToolsGenerationContext;
  /** Model name */
  model: string;
  /** Provider name */
  provider: string;
  /** List of tool IDs to enable */
  toolIds?: string[];
}

/**
 * Tool name generator function
 */
export type ToolNameGenerator = (identifier: string, apiName: string, type?: string) => string;

/**
 * ToolsEngine configuration options
 */
export interface ToolsEngineOptions {
  /** Default tool IDs that will always be added to the end of the tools list */
  defaultToolIds?: string[];
  /** Optional plugin enable checker function */
  enableChecker?: PluginEnableChecker;
  /** Optional function calling support checker function */
  functionCallChecker?: FunctionCallChecker;
  /** Optional tool name generator function */
  generateToolName?: ToolNameGenerator;
  /** Statically injected manifest schemas */
  manifestSchemas: LobeToolManifest[];
}

/**
 * Tools generation result
 */
export interface ToolsGenerationResult {
  /** List of enabled tool IDs */
  enabledToolIds: string[];
  /** Filtered plugins and their reasons */
  filteredTools: Array<{
    id: string;
    reason: 'not_found' | 'disabled' | 'incompatible';
  }>;
  /** Generated tools array */
  tools?: UniformTool[];
}

export interface UniformFunctions {
  /**
   * The description of what the function does.
   * @type {string}
   * @memberof UniformFunctions
   */
  description?: string;
  /**
   * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.
   * @type {string}
   * @memberof UniformFunctions
   */
  name: string;
  /**
   * The parameters the functions accepts, described as a JSON Schema object. See the [guide](/docs/guides/gpt/function-calling) for examples, and the [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for documentation about the format.
   * @type {{ [key: string]: any }}
   * @memberof UniformFunctions
   */
  parameters?: {
    [key: string]: any;
  };
}

export interface UniformTool {
  function: UniformFunctions;

  /**
   * The type of the tool. Currently, only `function` is supported.
   */
  type: 'function';
}
