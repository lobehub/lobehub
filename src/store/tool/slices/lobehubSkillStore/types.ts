/**
 * LobeHub Skill Server 连接状态
 */
export enum LobehubSkillStatus {
  /** 已连接，可以使用 */
  CONNECTED = 'connected',
  /** 连接中 */
  CONNECTING = 'connecting',
  /** 连接失败或 Token 过期 */
  ERROR = 'error',
  /** 未连接 */
  NOT_CONNECTED = 'not_connected',
}

/**
 * LobeHub Skill Tool 定义 (来自 Market API)
 */
export interface LobehubSkillTool {
  /** 工具描述 */
  description?: string;
  /** 工具输入的 JSON Schema */
  inputSchema: {
    additionalProperties?: boolean;
    properties?: Record<string, any>;
    required?: string[];
    type: string;
  };
  /** 工具名称 */
  name: string;
}

/**
 * LobeHub Skill Provider 定义 (来自 Market API)
 */
export interface LobehubSkillProvider {
  /** Provider 图标 URL */
  icon?: string;
  /** Provider ID (如 'linear', 'github') */
  id: string;
  /** 显示名称 */
  name: string;
  /** 是否支持刷新 Token */
  refreshSupported?: boolean;
  /** Provider 类型 */
  type?: 'mcp' | 'rest';
}

/**
 * LobeHub Skill Server 实例 (用户已连接的 provider)
 */
export interface LobehubSkillServer {
  /** 缓存时间戳 */
  cachedAt?: number;
  /** 错误信息 */
  errorMessage?: string;
  /** Provider 图标 URL */
  icon?: string;
  /** Provider ID (如 'linear') */
  identifier: string;
  /** 是否已认证 */
  isConnected: boolean;
  /** Provider 显示名称 */
  name: string;
  /** Provider 用户名 (如 GitHub username) */
  providerUsername?: string;
  /** 授权的 scopes */
  scopes?: string[];
  /** 连接状态 */
  status: LobehubSkillStatus;
  /** Token 过期时间 */
  tokenExpiresAt?: string;
  /** 工具列表 (已连接后可用) */
  tools?: LobehubSkillTool[];
}

/**
 * 调用 LobeHub Skill 工具的参数
 */
export interface CallLobehubSkillToolParams {
  /** 工具参数 */
  args?: Record<string, unknown>;
  /** Provider ID (如 'linear') */
  provider: string;
  /** 工具名称 */
  toolName: string;
}

/**
 * 调用 LobeHub Skill 工具的结果
 */
export interface CallLobehubSkillToolResult {
  /** 返回数据 */
  data?: any;
  /** 错误信息 */
  error?: string;
  /** 错误代码 */
  errorCode?: string;
  /** 是否成功 */
  success: boolean;
}
