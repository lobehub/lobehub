import { McpInstallSchema } from '../types';

/**
 * 协议安装相关的 Broadcast 事件（主进程 -> 渲染进程）
 */
export interface ProtocolBroadcastEvents {
  /**
   * MCP 插件安装请求事件
   * 主进程解析协议 URL 后发送给前端
   */
  mcpInstallRequest: (data: {
    /** 市场来源ID */
    marketId?: string;
    /** 插件ID */
    pluginId: string;
    /** MCP Schema 对象 */
    schema: McpInstallSchema;
  }) => void;
}
