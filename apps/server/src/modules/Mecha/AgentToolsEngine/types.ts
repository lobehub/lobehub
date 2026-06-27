import { type LobeToolManifest, type PluginEnableChecker } from '@lobechat/context-engine';
import {
  type BuiltinToolResolveContext,
  type LobeAgentAgencyConfig,
  type LobeBuiltinTool,
  type LobeTool,
} from '@lobechat/types';

import type { ExecutionPlan } from '@/helpers/executionTarget';

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
  /** Additional manifests to include (e.g., Composio tools) */
  additionalManifests?: LobeToolManifest[];
  /**
   * Override the list of builtin tools fed into the engine's
   * `manifestSchemas`. Defaults to the full `builtinTools` array from
   * `@lobechat/builtin-tools`. Callers gating device tools per-turn pass
   * `buildAllowedBuiltinTools(...)` here so an external bot sender cannot
   * resolve `lobe-remote-device` via the activator ().
   */
  builtinTools?: readonly LobeBuiltinTool[];
  /** Default tool IDs that will always be added */
  defaultToolIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
  /**
   * Identifiers to drop from `manifestSchemas` after combining plugin,
   * builtin, and additional manifests. Filtering builtins alone is not
   * enough: an installed plugin or a Skill/Composio manifest can declare
   * `identifier: 'lobe-remote-device'` and slip past `buildAllowedBuiltinTools`.
   * This is the final post-merge wall referenced in .
   */
  excludeIdentifiers?: ReadonlySet<string>;
  /**
   * Runtime context for context-aware builtin manifests. When provided, each
   * builtin tool with a `resolveManifest` produces its manifest for this context
   * (e.g. lobe-agent drops `callSubAgent` + its systemRole section inside a
   * sub-agent / group run). Omit for context-free callers — they get the full
   * static manifests. Mirrors the frontend `ToolsEngineConfig.manifestContext`.
   */
  manifestContext?: BuiltinToolResolveContext;
}

/**
 * Parameters for createServerAgentToolsEngine
 */
export interface ServerCreateAgentToolsEngineParams {
  /** Additional manifests to include (e.g., LobeHub Skills) */
  additionalManifests?: LobeToolManifest[];
  /** Agent configuration containing plugins array */
  agentConfig: {
    /** Agency config — execution target drives the runtime tool gate. */
    agencyConfig?: LobeAgentAgencyConfig;
    /** Optional agent chat config */
    chatConfig?: {
      /**
       * When explicitly `false`, the agent runs in chat mode — the engine
       * builds rules from `chatModeAllowedToolIds` only and ignores
       * `plugins` and `alwaysOnToolIds`. Undefined / true → agent mode.
       */
      enableAgentMode?: boolean;
      searchMode?: 'off' | 'on' | 'auto';
      /**
       * Overrides the `enableAgentMode` derivation. `custom` = the toolset is
       * exactly the agent's declared plugins (focused builtin sub-agents).
       */
      toolMode?: 'agent' | 'chat' | 'custom';
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
  /**
   * The run's resolved execution plan (see `resolveExecutionPlan`). When
   * provided, its effective `target` drives the runtime tool gate; when
   * omitted the engine derives the target from `agencyConfig` directly.
   */
  executionPlan?: ExecutionPlan;
  /** Whether the user's global memory setting is enabled */
  globalMemoryEnabled?: boolean;
  /** Whether agent has enabled knowledge bases */
  hasEnabledKnowledgeBases?: boolean;
  /** Whether the request originates from a bot conversation (auto-enables message tool) */
  isBotConversation?: boolean;
  /**
   * Whether this run is the group's supervisor (orchestrationRole === 'supervisor').
   * The group-orchestration tools ship only with the builtin group-supervisor
   * agent, so a user agent acting as supervisor would otherwise have no tool to
   * dispatch members and would silently degrade to a single-agent monologue.
   * When true the engine auto-enables the group-management + agent-builder tools.
   */
  isGroupSupervisor?: boolean;
  /**
   * Conversation context for context-aware builtin manifests (scope,
   * isSubAgent). Forwarded to `createServerToolsEngine` so tools like
   * lobe-agent can self-trim — hiding `callSubAgent` (tool + systemRole)
   * inside a sub-agent / group run.
   */
  manifestContext?: BuiltinToolResolveContext;
  /** Model name for function calling compatibility check */
  model: string;
  /** Provider name for function calling compatibility check */
  provider: string;
}
