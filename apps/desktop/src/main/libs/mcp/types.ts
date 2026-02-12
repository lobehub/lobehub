export interface McpTool {
  description: string;
  inputSchema: {
    [k: string]: unknown;
    properties?: unknown | null;
    type: 'object';
  };
  name: string;
}

export interface McpResource {
  description?: string;
  mimeType?: string;
  name: string;
  uri: string;
}

export interface McpPromptArgument {
  description?: string;
  name: string;
  required?: boolean;
}

export interface McpPrompt {
  arguments?: McpPromptArgument[];
  description?: string;
  name: string;
}

export interface TextContent {
  _meta?: any;
  text: string;
  type: 'text';
}

export interface ImageContent {
  _meta?: any;
  /**
   * Usually base64 data from MCP server (without data: prefix)
   */
  data: string;
  mimeType: string;
  type: 'image';
}

export interface AudioContent {
  _meta?: any;
  /**
   * Usually base64 data from MCP server (without data: prefix)
   */
  data: string;
  mimeType: string;
  type: 'audio';
}

export interface ResourceContent {
  _meta?: any;
  resource: {
    _meta?: any;
    blob?: string;
    mimeType?: string;
    text?: string;
    uri: string;
  };
  type: 'resource';
}

export interface ResourceLinkContent {
  _meta?: any;
  description?: string;
  icons?: Array<{
    mimeType?: string;
    sizes?: string[];
    src: string;
  }>;
  name: string;
  title?: string;
  type: 'resource_link';
  uri: string;
}

export type ToolCallContent =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceContent
  | ResourceLinkContent;

export interface ToolCallResult {
  content: ToolCallContent[];
  isError?: boolean;
  structuredContent?: any;
}

export interface AuthConfig {
  accessToken?: string;
  token?: string;
  type: 'none' | 'bearer' | 'oauth2';
}

export interface HttpMCPClientParams {
  auth?: AuthConfig;
  headers?: Record<string, string>;
  name: string;
  type: 'http';
  url: string;
}

export interface StdioMCPClientParams {
  args: string[];
  command: string;
  env?: Record<string, string>;
  name: string;
  type: 'stdio';
}

export type MCPClientParams = HttpMCPClientParams | StdioMCPClientParams;
