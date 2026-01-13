import { type LobehubSkillServer } from './types';

/**
 * LobeHub Skill Store 状态接口
 *
 * NOTE: 所有连接状态和工具数据都从 Market API 实时获取，不存储到本地数据库
 */
export interface LobehubSkillStoreState {
  /** 正在执行的工具调用 ID 集合 */
  lobehubSkillExecutingToolIds: Set<string>;
  /** 正在加载的 Provider ID 集合 */
  lobehubSkillLoadingIds: Set<string>;
  /** 已连接的 LobeHub Skill Server 列表 */
  lobehubSkillServers: LobehubSkillServer[];
}

/**
 * LobeHub Skill Store 初始状态
 */
export const initialLobehubSkillStoreState: LobehubSkillStoreState = {
  lobehubSkillExecutingToolIds: new Set(),
  lobehubSkillLoadingIds: new Set(),
  lobehubSkillServers: [],
};
