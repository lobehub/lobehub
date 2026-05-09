import { Md5 } from 'ts-md5';

import type { ChatToolPayload, MessageToolCall } from '@/types/index';

import type { LobeChatPluginApi, LobeToolManifest } from './types';

// Tool naming constants
const PLUGIN_SCHEMA_SEPARATOR = '____';
const PLUGIN_SCHEMA_API_MD5_PREFIX = 'MD5HASH_';
const TOOL_NAME_COMPONENT_PATTERN = /^[\w-]+$/;

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

  private hashComponent(name: string): string {
    return PLUGIN_SCHEMA_API_MD5_PREFIX + this.genHash(name);
  }

  /**
   * Strict providers reject tool function names with non-ASCII characters,
   * dots, slashes, spaces, or other punctuation. Hash invalid segments so the
   * generated name stays provider-safe while `resolve()` can still recover the
   * original value from the manifest.
   *
   * Example: `custom_mcp____中文API____mcp` is rejected, so the API segment
   * becomes `MD5HASH_xxx` on the wire.
   */
  private normalizeComponent(name: string): string {
    return name.length > 0 && !TOOL_NAME_COMPONENT_PATTERN.test(name)
      ? this.hashComponent(name)
      : name;
  }

  /**
   * Generate tool calling name
   * @param identifier - Plugin identifier
   * @param name - API name
   * @param type - Plugin type (default: 'builtin')
   * @returns Generated tool name (max 64 characters)
   */
  generate(identifier: string, name: string, type: string = 'builtin'): string {
    const pluginType =
      type && type !== 'builtin' && type !== 'default'
        ? `${PLUGIN_SCHEMA_SEPARATOR}${this.normalizeComponent(type)}`
        : '';
    let identifierName = this.normalizeComponent(identifier);
    let apiName = this.normalizeComponent(name);

    // Step 1: Try normal format
    let toolName = identifierName + PLUGIN_SCHEMA_SEPARATOR + apiName + pluginType;

    // OpenAI GPT function_call name can't be longer than 64 characters
    // Step 2: If >= 64, hash the name part
    if (toolName.length >= 64) {
      apiName = this.hashComponent(name);
      toolName = identifierName + PLUGIN_SCHEMA_SEPARATOR + apiName + pluginType;

      // Step 3: If still >= 64, also hash the identifier
      if (toolName.length >= 64) {
        identifierName = this.hashComponent(identifier);
        toolName = identifierName + PLUGIN_SCHEMA_SEPARATOR + apiName + pluginType;
      }
    }

    return toolName;
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
        const [initialIdentifier, apiName, type] =
          toolCall.function.name.split(PLUGIN_SCHEMA_SEPARATOR);
        let identifier = initialIdentifier;

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
          type: (type ?? manifests[identifier]?.type ?? 'builtin') as any,
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
