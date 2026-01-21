interface InputSchema {
  [k: string]: unknown;

  properties?: unknown | null;
  type: 'object';
}

export interface McpTool {
  description: string;
  inputSchema: InputSchema;
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

/**
 * MCP Tool Call Result Types
 */
export interface TextContent {
  _meta?: any;
  text: string;
  type: 'text';
}

export interface ImageContent {
  _meta?: any;
  data: string;
  // base64
  mimeType: string;
  type: 'image';
}

export interface AudioContent {
  _meta?: any;
  data: string;
  // base64
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

export interface MCPToolCallResult {
  content: string;
  error?: any;
  state: ToolCallResult;
  success: boolean;
}

/**
 * MCP 认证配置接口
 * 支持第一阶段的手动配置和未来的 OAuth 2.1 自动化流程
 */
export interface AuthConfig {
  // C. 用户授权后获取的【用户令牌】
  accessToken?: string;

  // 用户手动粘贴的 Bearer Token
  // --- Stage 2 & 3: OAuth 2.1 自动化流程 ---
  // A. 静态配置 或 动态注册获取的【客户端凭证】
  clientId?: string;

  clientSecret?: string;
  refreshToken?: string; // 如果是机密客户端
  scope?: string; // 想要申请的权限范围, e.g., "repo user:email"

  // B. 服务器发现机制获取的【授权服务器元数据】
  serverMetadata?: {
    authorization_endpoint?: string;
    registration_endpoint?: string;
    token_endpoint?: string;
    // ... and other RFC8414 fields
  };

  // --- Stage 1: 手动配置 ---
  token?: string;
  tokenExpiresAt?: number;
  // 认证类型
  type: 'none' | 'bearer' | 'oauth2'; // accessToken 的过期时间戳
}

interface HttpMCPClientParams {
  auth?: AuthConfig;
  headers?: Record<string, string>;
  name: string;
  type: 'http';
  url: string;
}

export interface StdioMCPParams {
  args: string[];
  command: string;
  env?: Record<string, string>;
  name: string;
  type: 'stdio';
}

export interface CloudMCPParams {
  auth?: AuthConfig;
  headers?: Record<string, string>;
  name: string;
  type: 'cloud';
  url: string;
}

export type MCPClientParams = HttpMCPClientParams | StdioMCPParams;

export type MCPErrorType =
  | 'CONNECTION_FAILED'
  | 'PROCESS_SPAWN_ERROR'
  | 'INITIALIZATION_TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_ERROR'
  | 'AUTHORIZATION_ERROR';
export interface MCPErrorData {
  message: string;
  /**
   * 结构化的错误元数据
   */
  metadata?: {
    errorLog?: string;

    /**
     * 原始错误信息
     */
    originalError?: string;
    /**
     * MCP 连接参数
     */
    params?: {
      args?: string[];
      command?: string;
      type?: string;
    };

    /**
     * 进程相关信息
     */
    process?: {
      exitCode?: number;
      signal?: string;
    };

    /**
     * 错误发生的步骤
     */
    step?: string;

    /**
     * 时间戳
     */
    timestamp?: number;
  };

  /**
   * 错误类型
   */
  type: MCPErrorType;
}

/**
 * 结构化的 MCP 错误信息
 */
export interface MCPError extends Error {
  data: MCPErrorData;
}

/**
 * 创建结构化的 MCP 错误
 */
export function createMCPError(
  type: MCPErrorData['type'],
  message: string,
  metadata?: MCPErrorData['metadata'],
): MCPError {
  const error = new Error(message) as MCPError;

  error.data = {
    message,
    metadata: {
      timestamp: Date.now(),
      ...metadata,
    },
    type,
  };

  return error;
}

/**
 * STDIO Process Output separator used in enhanced error messages
 */
const STDIO_OUTPUT_SEPARATOR = '--- STDIO Process Output ---';

/**
 * Parse error message to extract STDIO process output logs
 * The enhanced error format from desktop is:
 * "Original message\n\n--- STDIO Process Output ---\nlogs..."
 */
export interface ParsedStdioError {
  errorLog?: string;
  originalMessage: string;
}

export function parseStdioErrorMessage(errorMessage: string): ParsedStdioError {
  const separatorIndex = errorMessage.indexOf(STDIO_OUTPUT_SEPARATOR);

  if (separatorIndex === -1) {
    return { originalMessage: errorMessage };
  }

  const originalMessage = errorMessage.slice(0, separatorIndex).trim();
  const errorLog = errorMessage.slice(separatorIndex + STDIO_OUTPUT_SEPARATOR.length).trim();

  return {
    errorLog: errorLog || undefined,
    originalMessage: originalMessage || errorMessage,
  };
}
