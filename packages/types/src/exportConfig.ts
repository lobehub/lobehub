import { UIChatMessage } from './message';
import { LobeSessions, SessionGroupItem } from './session';
import { ChatTopic } from './topic';
import { UserSettings } from './user/settings';

// ---------- TODO: this file need to be deleted in V2 ---------- //

/**
 * 导出方式
 * @enum ['agents', 'sessions', 'singleSession', 'settings', 'all']
 * @enumNames ['agents', 'sessions', 'singleSession', 'settings', 'all']
 */
export type ExportType = 'agents' | 'sessions' | 'singleSession' | 'settings' | 'all';

/**
 * 配置模型映射
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

// =============   配置数据结构   ============= //

/**
 * 配置状态：会话
 */
export interface ConfigStateSessions {
  messages: UIChatMessage[];
  sessionGroups: SessionGroupItem[];
  sessions: LobeSessions;
  topics: ChatTopic[];
}

/**
 * 配置状态：单个会话
 */
export interface ConfigStateSingleSession {
  messages: UIChatMessage[];
  sessions: LobeSessions;
  topics: ChatTopic[];
}

/**
 * 配置状态：角色
 */
export interface ConfigStateAgents {
  sessionGroups: SessionGroupItem[];
  sessions: LobeSessions;
}

/**
 * 配置状态：设置
 */
export interface ConfigStateSettings {
  settings: UserSettings;
}

/**
 * 配置状态：全部
 */
export interface ConfigStateAll extends ConfigStateSessions, ConfigStateSettings {}

// =============   配置文件类型   ============= //

/**
 * 配置文件：设置
 */
export interface ConfigFileSettings {
  exportType: 'settings';
  state: ConfigStateSettings;
  version: number;
}

/**
 * 配置文件：会话
 */
export interface ConfigFileSessions {
  exportType: 'sessions';
  state: ConfigStateSessions;
  version: number;
}

/**
 * 配置文件：单个会话
 */
export interface ConfigFileSingleSession {
  exportType: 'sessions';
  state: ConfigStateSingleSession;
  version: number;
}

/**
 * 配置文件：角色
 */
export interface ConfigFileAgents {
  exportType: 'agents';
  state: ConfigStateAgents;
  version: number;
}

/**
 * 配置文件：全部
 */
export interface ConfigFileAll {
  exportType: 'all';
  state: ConfigStateAll;
  version: number;
}

/**
 * 配置文件
 */
export type ConfigFile = ConfigFileSettings | ConfigFileSessions | ConfigFileAll | ConfigFileAgents;
