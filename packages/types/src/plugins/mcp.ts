import type { PluginQueryParams, SystemDependency } from '@lobehub/market-sdk';
import { z } from 'zod';

import type { MCPErrorType } from '@/libs/mcp';

import type { McpConnectionType } from '../discover/mcp';
import type { CustomPluginMetadata } from '../tool/plugin';

/* eslint-disable typescript-sort-keys/string-enum */
export enum MCPInstallStep {
  CHECKING_INSTALLATION = 'CHECKING_INSTALLATION',
  COMPLETED = 'COMPLETED',
  CONFIGURATION_REQUIRED = 'CONFIGURATION_REQUIRED',
  DEPENDENCIES_REQUIRED = 'DEPENDENCIES_REQUIRED',
  ERROR = 'Error',
  FETCHING_MANIFEST = 'FETCHING_MANIFEST',
  GETTING_SERVER_MANIFEST = 'GETTING_SERVER_MANIFEST',
  INSTALLING_PLUGIN = 'INSTALLING_PLUGIN',
}

export interface CheckMcpInstallParams {
  /**
   * Installation details
   */
  installationDetails: {
    packageName?: string;
    repositoryUrlToClone?: string;
    setupSteps?: string[];
  };
  /**
   * Installation method
   */
  installationMethod: string;
  /**
   * System dependencies
   */
  systemDependencies?: SystemDependency[];
}

export interface CheckMcpInstallResult {
  allDependenciesMet?: boolean;
  /**
   * Check results for all deployment options
   */
  allOptions?: Array<{
    allDependenciesMet?: boolean;
    /**
     * Connection information for subsequent connection use
     */
    connection?: {
      args?: string[];
      command?: string;
      installationMethod: string;
      packageName?: string;
      repositoryUrl?: string;
    };
    isRecommended?: boolean;
    packageInstalled?: boolean;
    systemDependencies?: Array<{
      error?: string;
      installed: boolean;
      meetRequirement: boolean;
      name: string;
      version?: string;
    }>;
  }>;
  /**
   * Configuration schema, elevated to top level for easy access
   */
  configSchema?: any;
  /**
   * Connection information for subsequent connection use
   */
  connection?: {
    args?: string[];
    command?: string;
    type: 'stdio' | 'http';
    url?: string;
  };
  /**
   * Error information if detection fails
   */
  error?: string;
  /**
   * Whether this is the recommended option
   */
  isRecommended?: boolean;
  /**
   * Whether configuration is needed (e.g. API key, etc.)
   */
  needsConfig?: boolean;
  /**
   * Plugin installation detection result
   */
  packageInstalled?: boolean;
  platform: string;
  /**
   * Whether the detection result is successful
   */
  success: boolean;
  /**
   * System dependency detection results
   */
  systemDependencies?: Array<{
    error?: string;
    installed: boolean;
    meetRequirement: boolean;
    name: string;
    version?: string;
  }>;
}

export type MCPPluginListParams = Pick<PluginQueryParams, 'locale' | 'pageSize' | 'page' | 'q'> & {
  connectionType?: McpConnectionType;
};

export interface MCPErrorInfoMetadata {
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
   * Process-related information
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
}
/**
 * Structured error information
 */
export interface MCPErrorInfo {
  /**
   * Core error message (user-friendly brief description)
   */
  message: string;

  /**
   * Structured error metadata
   */
  metadata?: MCPErrorInfoMetadata;

  /**
   * Error type
   */
  type: MCPErrorType;
}

export interface MCPInstallProgress {
  checkResult?: CheckMcpInstallResult;
  configSchema?: any;
  // connection info from checkInstallation
  connection?: any;
  // Structured error information, displayed when installation fails
  errorInfo?: MCPErrorInfo;
  manifest?: any;
  // LobeChatPluginManifest
  needsConfig?: boolean;
  // 0-100
  progress: number;
  step: MCPInstallStep;
  // System dependency detection results, displayed when dependencies need to be installed
  systemDependencies?: Array<{
    error?: string;
    installInstructions?: {
      current?: string; // Installation command for the current system
      manual?: string; // Manual installation command
    };
    installed: boolean;
    meetRequirement: boolean;
    name: string;
    requiredVersion?: string;
    type?: string;
    version?: string;
    versionParsingRequired?: boolean;
  }>;
}

export interface McpConnection {
  args?: string[];
  auth?: {
    accessToken?: string;
    token?: string;
    type: 'none' | 'bearer' | 'oauth2';
  };
  // STDIO connection parameters
  command?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  type: 'http' | 'stdio';
  // HTTP connection parameters
  url?: string;
}

// Test connection parameter type
export interface McpConnectionParams {
  connection: McpConnection;
  identifier: string;
  metadata?: CustomPluginMetadata;
}

export type MCPInstallProgressMap = Record<string, MCPInstallProgress | undefined>;

// ============ Zod Schemas ============

/**
 * Zod schema for HTTP MCP authentication
 */
export const StreamableHTTPAuthSchema = z
  .object({
    accessToken: z.string().optional(), // OAuth2 Access Token
    token: z.string().optional(), // Bearer Token
    type: z.enum(['none', 'bearer', 'oauth2']),
  })
  .optional();

/**
 * Zod schema for getStreamableMcpServerManifest input
 */
export const GetStreamableMcpServerManifestInputSchema = z.object({
  auth: StreamableHTTPAuthSchema,
  headers: z.record(z.string()).optional(),
  identifier: z.string(),
  metadata: z
    .object({
      avatar: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
  url: z.string().url(),
});
