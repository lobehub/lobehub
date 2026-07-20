import { Md5 } from 'ts-md5';

import type { ChatToolPayload, MessageToolCall } from '@/types/index';

import type { LobeChatPluginApi, LobeToolManifest } from './types';

// Tool naming constants
const PLUGIN_SCHEMA_SEPARATOR = '____';
const PLUGIN_SCHEMA_API_MD5_PREFIX = 'MD5HASH_';
const TOOL_NAME_COMPONENT_PATTERN = /^[\w-]+$/;

// OpenAI GPT function_call names can't be longer than 64 characters, so long
// names are compressed to an MD5 hash. Other providers don't have this limit,
// and the opaque hash hurts readability, so the threshold is configurable via
// the `TOOL_NAME_MAX_LENGTH` env var (`0` disables length-based compression).
const DEFAULT_TOOL_NAME_MAX_LENGTH = 64;

/**
 * Read the threshold from env, defaulting to 64. Read directly (not through the
 * app env layer) and at module load so it is correct on every serverless worker
 * / cold start — the same name must compress identically wherever `generate()`
 * and `resolve()` run for an operation, including resume paths that never touch
 * the tool-engine setup. Guarded for non-Node runtimes (browser SPA) where
 * `process` may be undefined; there it falls back to the default.
 */
const readEnvMaxLength = (): number => {
  try {
    const raw = typeof process === 'undefined' ? undefined : process.env?.TOOL_NAME_MAX_LENGTH;
    if (raw === undefined || raw === '') return DEFAULT_TOOL_NAME_MAX_LENGTH;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TOOL_NAME_MAX_LENGTH;
  } catch {
    return DEFAULT_TOOL_NAME_MAX_LENGTH;
  }
};

let toolNameMaxLength = readEnvMaxLength();

/**
 * Override the max tool-name length before MD5 compression kicks in. Mainly for
 * tests and hosts that source the value differently; normal runtime picks it up
 * from env at module load. Pass `0` (or negative) to disable length-based
 * compression entirely; `undefined`/non-finite re-reads the env default.
 * Invalid-character normalization is independent and always applies.
 */
export const setToolNameMaxLength = (value: number | undefined): void => {
  toolNameMaxLength =
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : readEnvMaxLength();
};

/** Current max tool-name length; `0` means length-based compression is off. */
export const getToolNameMaxLength = (): number => toolNameMaxLength;

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

    // Length-based MD5 compression. Gated on the configured max length so it can
    // be tuned per deployment (or disabled with 0) — only providers that cap
    // function names (e.g. OpenAI at 64) actually need it, and the hash hurts
    // readability. `0`/negative disables it entirely. Invalid-character
    // normalization above is independent and always applies.
    const maxLength = getToolNameMaxLength();
    // Step 2: If >= maxLength, hash the name part
    if (maxLength > 0 && toolName.length >= maxLength) {
      apiName = this.hashComponent(name);
      toolName = identifierName + PLUGIN_SCHEMA_SEPARATOR + apiName + pluginType;

      // Step 3: If still >= maxLength, also hash the identifier
      if (toolName.length >= maxLength) {
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
   * @param offeredToolNames - Tool names actually sent to the LLM in this turn
   *   (e.g. `lobe-activator____activateTools`). When provided, the
   *   missing-prefix fallback only considers tools in this list, so a model
   *   can't trigger tools that weren't enabled for the current call and
   *   disabled duplicates can't shadow enabled ones.
   * @returns Resolved tool payloads
   */
  resolve(
    toolCalls: MessageToolCall[],
    manifests: Record<string, LobeToolManifest>,
    offeredToolNames?: string[],
  ): ChatToolPayload[] {
    const offeredSet = offeredToolNames ? new Set(offeredToolNames) : null;

    return toolCalls
      .map((toolCall): ChatToolPayload | null => {
        const [initialIdentifier, initialApiName, type] =
          toolCall.function.name.split(PLUGIN_SCHEMA_SEPARATOR);
        let identifier = initialIdentifier;
        let apiName = initialApiName;

        // Fallback for malformed tool names without the `____` separator
        // (e.g. model returns "activateTools" instead of
        // "lobe-activator____activateTools"). When the bare name uniquely
        // matches an API across the manifests we're allowed to consider,
        // recover the identifier so we don't silently drop the tool call.
        // The manifest's `type` is picked up by the existing `type ??
        // manifests[identifier]?.type` fallback when building the payload.
        if (!apiName) {
          const bareName = initialIdentifier;
          const matches: string[] = [];
          for (const [id, manifest] of Object.entries(manifests)) {
            const matchedApi = manifest?.api?.find(
              (api: LobeChatPluginApi) => api.name === bareName,
            );
            if (!matchedApi) continue;
            // Restrict to tools actually offered to the LLM this turn so a
            // model can't reach tools that weren't enabled, and so disabled
            // duplicates don't make an enabled call look ambiguous.
            if (offeredSet && !offeredSet.has(this.generate(id, matchedApi.name, manifest.type))) {
              continue;
            }
            matches.push(id);
          }
          if (matches.length === 1) {
            identifier = matches[0];
            apiName = bareName;
          } else {
            return null;
          }
        }

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
