import { type KlavisServer } from './types';

/**
 * Klavis Store 状态接口
 *
 * NOTE: API Key is NOT stored in client-side state for security reasons.
 * It's only available on the server-side.
 */
export interface KlavisStoreState {
  /** 正在执行的工具调用 ID 集合 */
  executingToolIds: Set<string>;
  /** 是否已完成初始化加载 */
  isServersInit: boolean;
  /** 正在加载的服务器 ID 集合 */
  loadingServerIds: Set<string>;
  /** 已创建的 Klavis Server 列表 */
  servers: KlavisServer[];
}

/**
 * Klavis Store 初始状态
 */
export const initialKlavisStoreState: KlavisStoreState = {
  executingToolIds: new Set(),
  isServersInit: false,
  loadingServerIds: new Set(),
  servers: [],
};
