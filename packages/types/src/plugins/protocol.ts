/**
 * Protocol source type
 */
export enum ProtocolSource {
  /** Community contribution */
  COMMUNITY = 'community',
  /** Developer custom */
  DEVELOPER = 'developer',
  /** GitHub official */
  GITHUB_OFFICIAL = 'github_official',
  /** Official LobeHub marketplace */
  OFFICIAL = 'official',
  /** Third-party marketplace */
  THIRD_PARTY = 'third_party',
}

/**
 * MCP Schema - stdio configuration type
 */
export interface McpStdioConfig {
  args?: string[];
  command: string;
  env?: Record<string, string>;
  type: 'stdio';
}

/**
 * MCP Schema - http configuration type
 */
export interface McpHttpConfig {
  headers?: Record<string, string>;
  type: 'http';
  url: string;
}

/**
 * MCP Schema configuration type
 */
export type McpConfig = McpStdioConfig | McpHttpConfig;

/**
 * MCP Schema object
 * Conforms to RFC 0001 definition
 */
export interface McpSchema {
  /** Plugin author */
  author: string;
  /** Plugin configuration */
  config: McpConfig;
  /** Plugin description */
  description: string;
  /** Plugin homepage */
  homepage?: string;
  /** Plugin icon */
  icon?: string;
  /** Plugin unique identifier, must match the id parameter in the URL */
  identifier: string;
  /** Plugin name */
  name: string;
  /** Plugin version (semver) */
  version: string;
}

/**
 * RFC 0001 protocol parameters
 * lobehub://plugin/install?id=xxx&schema=xxx&marketId=xxx&meta_*=xxx
 */
export interface McpInstallProtocolParamsRFC {
  /** Optional UI display metadata, prefixed with meta_ */
  [key: `meta_${string}`]: string | undefined;
  /** Unique identifier of the plugin */
  id: string;
  /** Unique identifier of the Marketplace providing this plugin */
  marketId?: string;
  /** Base64URL encoded MCP Schema object */
  schema: string;
  /** Plugin type, fixed as 'mcp' for MCP */
  type: 'mcp';
}

/**
 * Protocol URL parsing result
 */
export interface ProtocolUrlParsed {
  /** Action type (e.g.: 'install') */
  action: 'install' | 'configure' | 'update';
  /** Parsed parameters */
  params: {
    id: string;
    marketId?: string;
    type: string;
  };
  /** MCP Schema object */
  schema: McpSchema;
  /** Protocol source */
  source: ProtocolSource;
  /** Plugin type (e.g.: 'mcp') */
  type: 'mcp' | 'plugin';
  /** URL type (e.g.: 'plugin') */
  urlType: string;
}

/**
 * Installation confirmation dialog information
 */
export interface InstallConfirmationInfo {
  dependencies?: string[];
  permissions?: {
    filesystem?: boolean;
    network?: boolean;
    system?: boolean;
  };
  pluginInfo: {
    author?: string;
    description: string;
    homepage?: string;
    icon?: string;
    identifier: string;
    name: string;
    version: string;
  };
  source: {
    platform?: {
      name: string;
      url?: string;
    };
    type: ProtocolSource;
    verified: boolean; // Whether it's a verified source
  };
}

/**
 * Protocol handler interface
 */
export interface ProtocolHandler {
  /**
   * Handle protocol URL
   */
  handle: (
    parsed: ProtocolUrlParsed,
  ) => Promise<{ error?: string; success: boolean; targetWindow?: string }>;

  /**
   * Supported actions
   */
  readonly supportedActions: string[];

  /**
   * Protocol type
   */
  readonly type: string;
}

/**
 * Protocol routing configuration
 */
export interface ProtocolRouteConfig {
  /** Action type */
  action: string;
  /** Target path (relative to window base path) */
  targetPath?: string;
  /** Target window */
  targetWindow: 'chat' | 'settings';
  /** Protocol type */
  type: string;
}
