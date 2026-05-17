import { type LobeToolManifest, type PluginEnableChecker } from '@lobechat/context-engine';
import { type LobeBuiltinTool, type LobeTool, type RuntimeEnvConfig } from '@lobechat/types';

/**
 * Installed plugin with manifest
 */
export type InstalledPlugin = LobeTool;

/**
 * Context for server-side tools engine
 */
export interface ServerAgentToolsContext {
  /** Installed plugins from database */
  installedPlugins: InstalledPlugin[];
  /** Whether the model supports tool use (function calling) */
  isModelSupportToolUse: (model: string, provider: string) => boolean;
}

/**
 * Configuration options for createServerToolsEngine
 */
export interface ServerAgentToolsEngineConfig {
  /** Additional manifests to include (e.g., Klavis tools) */
  additionalManifests?: LobeToolManifest[];
  /**
   * Override the list of builtin tools fed into the engine's
   * `manifestSchemas`. Defaults to the full `builtinTools` array from
   * `@lobechat/builtin-tools`. Callers gating device tools per-turn pass
   * `buildAllowedBuiltinTools(...)` here so an external bot sender cannot
   * resolve `lobe-remote-device` via the activator (LOBE-8768).
   */
  builtinTools?: readonly LobeBuiltinTool[];
  /** Default tool IDs that will always be added */
  defaultToolIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
  /**
   * Identifiers to drop from `manifestSchemas` after combining plugin,
   * builtin, and additional manifests. Filtering builtins alone is not
   * enough: an installed plugin or a Skill/Klavis manifest can declare
   * `identifier: 'lobe-remote-device'` and slip past `buildAllowedBuiltinTools`.
   * This is the final post-merge wall referenced in LOBE-8768.
   */
  excludeIdentifiers?: ReadonlySet<string>;
}

/**
 * Parameters for createServerAgentToolsEngine
 */
export interface ServerCreateAgentToolsEngineParams {
  /** Additional manifests to include (e.g., LobeHub Skills) */
  additionalManifests?: LobeToolManifest[];
  /** Agent configuration containing plugins array */
  agentConfig: {
    /** Optional agent chat config */
    chatConfig?: {
      /**
       * When explicitly `false`, the agent runs in chat mode — the engine
       * builds rules from `chatModeAllowedToolIds` only and ignores
       * `plugins` and `alwaysOnToolIds`. Undefined / true → agent mode.
       */
      enableAgentMode?: boolean;
      runtimeEnv?: RuntimeEnvConfig;
      searchMode?: 'off' | 'on' | 'auto';
    };
    /** Plugin IDs enabled for this agent */
    plugins?: string[];
  };
  /**
   * Whether device tools (local-system / remote-device) are allowed this turn.
   * Computed by `resolveDeviceAccessPolicy` from the caller identity:
   * first-party UI and bot-owner senders pass; external bot senders and
   * unconfigured bot owners do not. The engine treats this as the FINAL
   * answer — never re-derive from `isBotConversation` or `botContext`.
   * Defaults to `false` (fail-closed) when the caller forgets to plumb it.
   */
  canUseDevice?: boolean;
  /**
   * Runtime of the client initiating this request. When `'desktop'`, the
   * caller itself is an Electron client connected via the Agent Gateway WS,
   * so tools with `executor: 'client'` (e.g. local-system, stdio MCP) can be
   * dispatched back to it via `tool_execute` — no remote-device proxy needed.
   */
  clientRuntime?: 'desktop' | 'web';
  /** Device gateway context for remote tool calling */
  deviceContext?: {
    /** When true, a device has been auto-activated — Remote Device tool is unnecessary */
    autoActivated?: boolean;
    boundDeviceId?: string;
    deviceOnline?: boolean;
    gatewayConfigured: boolean;
  };
  /** Whether to suppress the local-system builtin while preserving other tools. */
  disableLocalSystem?: boolean;
  /** Whether the user's global memory setting is enabled */
  globalMemoryEnabled?: boolean;
  /** Whether agent has agent documents */
  hasAgentDocuments?: boolean;
  /** Whether agent has enabled knowledge bases */
  hasEnabledKnowledgeBases?: boolean;
  /** Whether the request originates from a bot conversation (auto-enables message tool) */
  isBotConversation?: boolean;
  /** Model name for function calling compatibility check */
  model: string;
  /** Provider name for function calling compatibility check */
  provider: string;
}
