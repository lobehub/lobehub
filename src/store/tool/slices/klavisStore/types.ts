/**
 * Klavis Server 连接状态
 */
export enum KlavisServerStatus {
  /** 已连接，可以使用 */
  CONNECTED = 'connected',
  /** 连接失败 */
  ERROR = 'error',
  /** 未认证，需要完成 OAuth 流程 */
  PENDING_AUTH = 'pending_auth',
}

/**
 * Klavis 工具定义（MCP 格式）
 */
export interface KlavisTool {
  /** 工具描述 */
  description?: string;
  /** 工具输入的 JSON Schema */
  inputSchema: {
    properties?: Record<string, any>;
    required?: string[];
    type: string;
  };
  /** 工具名称 */
  name: string;
}

/**
 * Klavis Server 实例
 */
export interface KlavisServer {
  /** 创建时间戳 */
  createdAt: number;
  /** 错误信息（如果有） */
  errorMessage?: string;
  /** 服务器图标 URL */
  icon?: string;
  /**
   * 标识符，用于存储到数据库（如 'google-calendar'）
   * 格式：小写，空格替换为连字符
   */
  identifier: string;
  /** Klavis 实例 ID */
  instanceId: string;
  /** 是否已认证 */
  isAuthenticated: boolean;
  /** OAuth 认证 URL */
  oauthUrl?: string;
  /**
   * 服务器名称，用于调用 Klavis API（如 'Google Calendar'）
   */
  serverName: string;
  /** 服务器 URL (用于连接和调用工具) */
  serverUrl: string;
  /** 连接状态 */
  status: KlavisServerStatus;
  /** 服务器提供的工具列表 */
  tools?: KlavisTool[];
}

/**
 * 创建 Klavis Server 的参数
 */
export interface CreateKlavisServerParams {
  /**
   * 标识符，用于存储到数据库（如 'google-calendar'）
   */
  identifier: string;
  /**
   * 服务器名称，用于调用 Klavis API（如 'Google Calendar'）
   */
  serverName: string;
  /** 用户 ID */
  userId: string;
}

/**
 * 调用 Klavis 工具的参数
 */
export interface CallKlavisToolParams {
  /** Strata Server URL */
  serverUrl: string;
  /** 工具参数 */
  toolArgs?: Record<string, unknown>;
  /** 工具名称 */
  toolName: string;
}

/**
 * 调用 Klavis 工具的结果
 */
export interface CallKlavisToolResult {
  /** 返回数据 */
  data?: any;
  /** 错误信息 */
  error?: string;
  /** 是否成功 */
  success: boolean;
}
