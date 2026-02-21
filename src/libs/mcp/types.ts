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
 * MCP authentication configuration interface
 * Supports manual configuration in the first stage and future OAuth 2.1 automated flow
 */
export interface AuthConfig {
  // C. User token obtained after user authorization
  accessToken?: string;

  // Bearer Token manually pasted by user
  // --- Stage 2 & 3: OAuth 2.1 automated flow ---
  // A. Client credentials obtained through static configuration or dynamic registration
  clientId?: string;

  clientSecret?: string;
  refreshToken?: string; // For confidential clients
  scope?: string; // Requested permission scope, e.g., "repo user:email"

  // B. Authorization server metadata obtained through server discovery mechanism
  serverMetadata?: {
    authorization_endpoint?: string;
    registration_endpoint?: string;
    token_endpoint?: string;
    // ... and other RFC8414 fields
  };

  // --- Stage 1: Manual configuration ---
  token?: string;
  tokenExpiresAt?: number;
  // Authentication type
  type: 'none' | 'bearer' | 'oauth2'; // Expiration timestamp of accessToken
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
   * Structured error metadata
   */
  metadata?: {
    errorLog?: string;

    /**
     * Original error message
     */
    originalError?: string;
    /**
     * MCP connection parameters
     */
    params?: {
      args?: string[];
      command?: string;
      type?: string;
    };

    /**
     * Process related information
     */
    process?: {
      exitCode?: number;
      signal?: string;
    };

    /**
     * Step where the error occurred
     */
    step?: string;

    /**
     * Timestamp
     */
    timestamp?: number;
  };

  /**
   * Error type
   */
  type: MCPErrorType;
}

/**
 * Structured MCP error information
 */
export interface MCPError extends Error {
  data: MCPErrorData;
}

/**
 * Create a structured MCP error
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
