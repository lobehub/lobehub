import { type LobeToolManifest, type PluginEnableChecker } from '@lobechat/context-engine';
import { type LobeTool } from '@lobechat/types';

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
  /** Default tool IDs that will always be added */
  defaultToolIds?: string[];
  /** Custom enable checker for plugins */
  enableChecker?: PluginEnableChecker;
}

/**
 * Parameters for createServerAgentToolsEngine
 */
export interface ServerCreateAgentToolsEngineParams {
  /** Additional manifests to include (e.g., LobeHub Skills) */
  additionalManifests?: LobeToolManifest[];
  /** Agent configuration containing plugins array */
  agentConfig: {
    /** Optional agent chat config with searchMode */
    chatConfig?: {
      searchMode?: 'off' | 'on' | 'auto';
    };
    /** Plugin IDs enabled for this agent */
    plugins?: string[];
  };
  /** Whether agent has enabled knowledge bases */
  hasEnabledKnowledgeBases?: boolean;
  /** Model name for function calling compatibility check */
  model: string;
  /** Provider name for function calling compatibility check */
  provider: string;
}
