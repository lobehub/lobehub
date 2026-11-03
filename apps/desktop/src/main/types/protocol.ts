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
 * Protocol URL parsing result
 */
export interface ProtocolUrlParsed {
  /** Action type (e.g., 'install') */
  action: string;
  /** Original URL */
  originalUrl: string;
  /** All parsed query parameters */
  params: Record<string, string>;
  /** URL type (e.g., 'plugin') */
  urlType: string;
}
