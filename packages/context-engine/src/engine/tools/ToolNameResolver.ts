import { Md5 } from 'ts-md5';

import type { ChatToolPayload, MessageToolCall } from '@/types/index';

import type { LobeChatPluginApi, LobeToolManifest } from './types';

// Tool naming constants
const PLUGIN_SCHEMA_SEPARATOR = '____';
const PLUGIN_SCHEMA_API_MD5_PREFIX = 'MD5HASH_';

/**
 * Tool Name Resolver
 * Handles tool name generation and resolution for function calling
 */
export class ToolNameResolver {
  /**
   * Generate MD5 hash for tool name shortening
   * @private
   */
  private genHash(name: string): string {
    return Md5.hashStr(name).toString().slice(0, 12);
  }

  /**
   * Generate tool calling name
   * @param identifier - Plugin identifier
   * @param name - API name
   * @param type - Plugin type (default: 'default')
   * @returns Generated tool name (max 64 characters)
   */
  generate(identifier: string, name: string, type: string = 'default'): string {
    const pluginType = type && type !== 'default' ? `${PLUGIN_SCHEMA_SEPARATOR}${type}` : '';

    // Step 1: Try normal format
    let apiName = identifier + PLUGIN_SCHEMA_SEPARATOR + name + pluginType;

    // OpenAI GPT function_call name can't be longer than 64 characters
    // Step 2: If >= 64, hash the name part
    if (apiName.length >= 64) {
      const nameHash = PLUGIN_SCHEMA_API_MD5_PREFIX + this.genHash(name);
      apiName = identifier + PLUGIN_SCHEMA_SEPARATOR + nameHash + pluginType;

      // Step 3: If still >= 64, also hash the identifier
      if (apiName.length >= 64) {
        const identifierHash = PLUGIN_SCHEMA_API_MD5_PREFIX + this.genHash(identifier);
        apiName = identifierHash + PLUGIN_SCHEMA_SEPARATOR + nameHash + pluginType;
      }
    }

    return apiName;
  }

  /**
   * Resolve tool calls from AI response back to original tool information
   * @param toolCalls - Tool calls from AI model response
   * @param manifests - Available tool manifests mapped by identifier
   * @returns Resolved tool payloads
   */
  resolve(
    toolCalls: MessageToolCall[],
    manifests: Record<string, LobeToolManifest>,
  ): ChatToolPayload[] {
    return toolCalls
      .map((toolCall): ChatToolPayload | null => {
        let [identifier, apiName, type] = toolCall.function.name.split(PLUGIN_SCHEMA_SEPARATOR);

        if (!apiName) return null;

        // Step 1: Resolve hashed identifier if needed
        if (identifier.startsWith(PLUGIN_SCHEMA_API_MD5_PREFIX)) {
          const identifierMd5 = identifier.replace(PLUGIN_SCHEMA_API_MD5_PREFIX, '');
          // Find the manifest by hashed identifier
          const foundIdentifier = Object.keys(manifests).find(
            (id) => this.genHash(id) === identifierMd5,
          );
          if (foundIdentifier) {
            identifier = foundIdentifier;
          }
        }

        const payload: ChatToolPayload = {
          apiName,
          arguments: toolCall.function.arguments,
          id: toolCall.id,
          identifier,
          thoughtSignature: toolCall.thoughtSignature,
          type: (type ?? 'default') as any,
        };

        // Step 2: Resolve hashed apiName if needed
        if (apiName.startsWith(PLUGIN_SCHEMA_API_MD5_PREFIX) && manifests[identifier]) {
          const md5 = apiName.replace(PLUGIN_SCHEMA_API_MD5_PREFIX, '');
          const manifest = manifests[identifier];

          const api = manifest?.api.find(
            (api: LobeChatPluginApi) => this.genHash(api.name) === md5,
          );
          if (api) {
            payload.apiName = api.name;
          }
        }

        return payload;
      })
      .filter(Boolean) as ChatToolPayload[];
  }
}
