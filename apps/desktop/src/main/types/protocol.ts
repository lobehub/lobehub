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
  /** Plugin unique identifier，必须与URL中的id参数匹配 */
  identifier: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 (semver) */
  version: string;
}

/**
 * 协议URL解析结果
 */
export interface ProtocolUrlParsed {
  /** Action type (e.g., 'install') */
  action: string;
  /** 原始URL */
  originalUrl: string;
  /** 解析后的所有查询参数 */
  params: Record<string, string>;
  /** URL类型 (如: 'plugin') */
  urlType: string;
}
