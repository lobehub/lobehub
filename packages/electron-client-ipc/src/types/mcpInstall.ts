export interface MCPInstallConfig {
  args?: string[];
  command?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  type: 'stdio' | 'http';
  url?: string;
}

export interface McpInstallSchema {
  author: string;
  config: MCPInstallConfig;
  description: string;
  homepage?: string;
  icon?: string;
  identifier: string;
  name: string;
  version: string;
}
