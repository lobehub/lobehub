import { type MarketConnectServer } from './types';

/**
 * Market Connect Store 状态接口
 *
 * NOTE: 所有连接状态和工具数据都从 Market API 实时获取，不存储到本地数据库
 */
export interface MarketConnectStoreState {
  /** 正在执行的工具调用 ID 集合 */
  marketConnectExecutingToolIds: Set<string>;
  /** 正在加载的 Provider ID 集合 */
  marketConnectLoadingIds: Set<string>;
  /** 已连接的 Market Connect Server 列表 */
  marketConnectServers: MarketConnectServer[];
}

/**
 * Market Connect Store 初始状态
 */
export const initialMarketConnectStoreState: MarketConnectStoreState = {
  marketConnectExecutingToolIds: new Set(),
  marketConnectLoadingIds: new Set(),
  marketConnectServers: [],
};
