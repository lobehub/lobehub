import { app } from 'electron';

import { McpSchema, ProtocolUrlParsed } from '../types/protocol';

export type AppChannel = 'stable' | 'beta' | 'nightly';

export const getProtocolScheme = (): string => {
  // In Electron environment, version can be determined in multiple ways
  const bundleId = app.name;
  const appPath = app.getPath('exe');

  // Determine by bundle identifier
  if (bundleId?.toLowerCase().includes('nightly')) return 'lobehub-nightly';
  if (bundleId?.toLowerCase().includes('beta')) return 'lobehub-beta';
  if (bundleId?.includes('dev')) return 'lobehub-dev';

  // Determine by executable file path
  if (appPath?.toLowerCase().includes('nightly')) return 'lobehub-nightly';
  if (appPath?.toLowerCase().includes('beta')) return 'lobehub-beta';
  if (appPath?.includes('dev')) return 'lobehub-dev';

  return 'lobehub';
};

export const getVersionInfo = (): { channel: AppChannel; protocolScheme: string } => {
  const protocolScheme = getProtocolScheme();

  let appChannel: AppChannel = 'stable';
  if (protocolScheme.includes('nightly')) {
    appChannel = 'nightly';
  } else if (protocolScheme.includes('beta')) {
    appChannel = 'beta';
  }

  return {
    channel: appChannel,
    protocolScheme,
  };
};

/**
 * Validate MCP Schema object structure
 * @param schema Object to validate
 * @returns Whether it's a valid MCP Schema
 */
function validateMcpSchema(schema: any): schema is McpSchema {
  if (!schema || typeof schema !== 'object') return false;

  // Required field validation
  if (typeof schema.identifier !== 'string' || !schema.identifier) return false;
  if (typeof schema.name !== 'string' || !schema.name) return false;
  if (typeof schema.author !== 'string' || !schema.author) return false;
  if (typeof schema.description !== 'string' || !schema.description) return false;
  if (typeof schema.version !== 'string' || !schema.version) return false;

  // Optional field validation
  if (schema.homepage !== undefined && typeof schema.homepage !== 'string') return false;
  if (schema.icon !== undefined && typeof schema.icon !== 'string') return false;

  // config field validation
  if (!schema.config || typeof schema.config !== 'object') return false;
  const config = schema.config;

  if (config.type === 'stdio') {
    if (typeof config.command !== 'string' || !config.command) return false;
    if (config.args !== undefined && !Array.isArray(config.args)) return false;
    if (config.env !== undefined && typeof config.env !== 'object') return false;
  } else if (config.type === 'http') {
    if (typeof config.url !== 'string' || !config.url) return false;
    try {
      new URL(config.url); // Validate URL format
    } catch {
      return false;
    }
    if (config.headers !== undefined && typeof config.headers !== 'object') return false;
  } else {
    return false; // Unknown config type
  }

  return true;
}

/**
 * Parse lobehub:// protocol URL (supports multi-version protocols)
 *
 * Supported URL formats:
 * - lobehub://plugin/install?id=figma&schema=xxx&marketId=lobehub
 * - lobehub://plugin/configure?id=xxx&...
 * - lobehub-bet://plugin/install?id=figma&schema=xxx&marketId=lobehub
 * - lobehub-nightly://plugin/install?id=figma&schema=xxx&marketId=lobehub
 * - lobehub-dev://plugin/install?id=figma&schema=xxx&marketId=lobehub
 *
 * @param url Protocol URL
 * @returns Parse result, including basic structure and all query parameters
 */
export const parseProtocolUrl = (url: string): ProtocolUrlParsed | null => {
  try {
    const parsedUrl = new URL(url);

    // Support multiple protocol schemes
    const validProtocols = ['lobehub:', 'lobehub-dev:', 'lobehub-nightly:', 'lobehub-beta:'];
    if (!validProtocols.includes(parsedUrl.protocol)) {
      return null;
    }

    // For custom protocols, after URL parsing:
    // lobehub://plugin/install -> hostname: "plugin", pathname: "/install"
    const urlType = parsedUrl.hostname; // "plugin"
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean); // ["install"]

    if (pathParts.length < 1) {
      return null;
    }

    const action = pathParts[0]; // "install"

    // Parse all query parameters
    const params: Record<string, string> = {};
    const searchParams = new URLSearchParams(parsedUrl.search);

    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }

    return {
      action,
      originalUrl: url,
      params,
      urlType,
    };
  } catch (error) {
    console.error('Failed to parse protocol URL:', error);
    return null;
  }
};

/**
 * Generate RFC 0001 compliant protocol URL
 *
 * @param params Protocol parameters
 * @returns Generated protocol URL
 */
export function generateRFCProtocolUrl(params: {
  /** Plugin unique identifier */
  id: string;
  /** Marketplace ID */
  marketId?: string;
  /** MCP Schema object */
  schema: McpSchema;
  /** Protocol scheme (default: lobehub) */
  scheme?: string;
}): string {
  const { id, schema, marketId, scheme = 'lobehub' } = params;

  // Validate schema.identifier matches id
  if (schema.identifier !== id) {
    throw new Error('Schema identifier must match the id parameter');
  }

  // Validate schema structure
  if (!validateMcpSchema(schema)) {
    throw new Error('Invalid MCP Schema structure');
  }

  // Build base URL
  const baseUrl = `${scheme}://plugin/install`;

  // Build query parameters
  const searchParams = new URLSearchParams();

  // Required parameters
  searchParams.set('type', 'mcp');
  searchParams.set('id', id);

  // Encode schema - pass JSON string directly, let URLSearchParams auto-encode
  const schemaJson = JSON.stringify(schema);
  searchParams.set('schema', schemaJson);

  // Optional parameters
  if (marketId) {
    searchParams.set('marketId', marketId);
  }

  return `${baseUrl}?${searchParams.toString()}`;
}

/**
 * Generate protocol URL example
 *
 * @example
 * ```typescript
 * const url = generateRFCProtocolUrl({
 *   id: 'edgeone-mcp',
 *   schema: {
 *     identifier: 'edgeone-mcp',
 *     name: 'EdgeOne MCP',
 *     author: 'Higress Team',
 *     description: 'EdgeOne API integration for LobeChat',
 *     version: '1.0.0',
 *     config: {
 *       type: 'stdio',
 *       command: 'npx',
 *       args: ['-y', '@higress/edgeone-mcp']
 *     }
 *   },
 *   marketId: 'higress'
 * });
 * // Result: lobehub://plugin/install?id=edgeone-mcp&schema=%7B%22identifier%22%3A...&marketId=higress
 * ```
 */
