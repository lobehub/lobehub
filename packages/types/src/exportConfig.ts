import type { UIChatMessage } from './message';
import type { LobeSessions, SessionGroupItem } from './session';
import type { ChatTopic } from './topic';
import type { UserSettings } from './user/settings';

// ---------- TODO: this file need to be deleted in V2 ---------- //

/**
 * Export type
 * @enum ['agents', 'sessions', 'singleSession', 'settings', 'all']
 * @enumNames ['agents', 'sessions', 'singleSession', 'settings', 'all']
 */
export type ExportType = 'agents' | 'sessions' | 'singleSession' | 'settings' | 'all';

/**
 * Config model map
 */
export interface ConfigModelMap {
  agents: {
    file: ConfigFileAgents;
    state: ConfigStateAgents;
  };
  all: {
    file: ConfigFileAll;
    state: ConfigStateAll;
  };
  sessions: {
    file: ConfigFileSessions;
    state: ConfigStateSessions;
  };
  settings: {
    file: ConfigFileSettings;
    state: ConfigStateSettings;
  };
  singleSession: {
    file: ConfigFileSingleSession;
    state: ConfigStateSingleSession;
  };
}

// =============   Config Data Structures   ============= //

/**
 * Config state: Sessions
 */
export interface ConfigStateSessions {
  messages: UIChatMessage[];
  sessionGroups: SessionGroupItem[];
  sessions: LobeSessions;
  topics: ChatTopic[];
}

/**
 * Config state: Single session
 */
export interface ConfigStateSingleSession {
  messages: UIChatMessage[];
  sessions: LobeSessions;
  topics: ChatTopic[];
}

/**
 * Config state: Agents
 */
export interface ConfigStateAgents {
  sessionGroups: SessionGroupItem[];
  sessions: LobeSessions;
}

/**
 * Config state: Settings
 */
export interface ConfigStateSettings {
  settings: UserSettings;
}

/**
 * Config state: All
 */
export interface ConfigStateAll extends ConfigStateSessions, ConfigStateSettings {}

// =============   Config File Types   ============= //

/**
 * Config file: Settings
 */
export interface ConfigFileSettings {
  exportType: 'settings';
  state: ConfigStateSettings;
  version: number;
}

/**
 * Config file: Sessions
 */
export interface ConfigFileSessions {
  exportType: 'sessions';
  state: ConfigStateSessions;
  version: number;
}

/**
 * Config file: Single session
 */
export interface ConfigFileSingleSession {
  exportType: 'sessions';
  state: ConfigStateSingleSession;
  version: number;
}

/**
 * Config file: Agents
 */
export interface ConfigFileAgents {
  exportType: 'agents';
  state: ConfigStateAgents;
  version: number;
}

/**
 * Config file: All
 */
export interface ConfigFileAll {
  exportType: 'all';
  state: ConfigStateAll;
  version: number;
}

/**
 * Config file
 */
export type ConfigFile = ConfigFileSettings | ConfigFileSessions | ConfigFileAll | ConfigFileAgents;
