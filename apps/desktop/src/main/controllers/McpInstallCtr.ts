import { createLogger } from '@/utils/logger';

import { ControllerModule, createProtocolHandler } from '.';
import { McpSchema } from '../types/protocol';

const logger = createLogger('controllers:McpInstallCtr');

const protocolHandler = createProtocolHandler('plugin');

/**
 * Validate MCP Schema object structure
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

interface McpInstallParams {
  id: string;
  marketId?: string;
  schema?: any;
}

/**
 * MCP plugin installation controller
 * Responsible for handling MCP plugin installation process
 */
export default class McpInstallController extends ControllerModule {
  /**
   * Handle MCP plugin installation request
   * @param parsedData Parsed protocol data
   * @returns Whether processing succeeded
   */
  @protocolHandler('install')
  public async handleInstallRequest(parsedData: McpInstallParams): Promise<boolean> {
    try {
      // Extract required fields from parameters
      const { id, schema: schemaParam, marketId } = parsedData;

      if (!id) {
        logger.warn(`🔧 [McpInstall] Missing required MCP parameters:`, {
          id: !!id,
        });
        return false;
      }

      // Map protocol source

      const isOfficialMarket = marketId === 'lobehub';

      // For official marketplace, schema is optional; for third-party marketplace, schema is required
      if (!isOfficialMarket && !schemaParam) {
        logger.warn(`🔧 [McpInstall] Schema is required for third-party marketplace:`, {
          marketId,
        });
        return false;
      }

      let mcpSchema: McpSchema | undefined;

      // If schema parameter is provided, parse and validate
      if (schemaParam) {
        try {
          mcpSchema = JSON.parse(schemaParam);
        } catch (error) {
          logger.error(`🔧 [McpInstall] Failed to parse MCP schema:`, error);
          return false;
        }

        if (!validateMcpSchema(mcpSchema)) {
          logger.error(`🔧 [McpInstall] Invalid MCP Schema structure`);
          return false;
        }

        // Verify identifier matches id parameter
        if (mcpSchema.identifier !== id) {
          logger.error(`🔧 [McpInstall] Schema identifier does not match URL id parameter:`, {
            schemaId: mcpSchema.identifier,
            urlId: id,
          });
          return false;
        }
      }

      logger.debug(`🔧 [McpInstall] MCP install request validated:`, {
        hasSchema: !!mcpSchema,
        marketId,
        pluginId: id,
        pluginName: mcpSchema?.name || 'Unknown',
        pluginVersion: mcpSchema?.version || 'Unknown',
      });

      // Broadcast installation request to frontend
      const installRequest = {
        marketId,
        pluginId: id,
        schema: mcpSchema,
      };

      logger.debug(`🔧 [McpInstall] Broadcasting install request:`, {
        hasSchema: !!installRequest.schema,
        marketId: installRequest.marketId,
        pluginId: installRequest.pluginId,
        pluginName: installRequest.schema?.name || 'Unknown',
      });

      // Broadcast to frontend via app instance
      if (this.app?.browserManager) {
        this.app.browserManager.broadcastToWindow('app', 'mcpInstallRequest', installRequest);
        logger.debug(`🔧 [McpInstall] Install request broadcasted successfully`);
        return true;
      } else {
        logger.error(`🔧 [McpInstall] App or browserManager not available`);
        return false;
      }
    } catch (error) {
      logger.error(`🔧 [McpInstall] Error processing install request:`, error);
      return false;
    }
  }
}
