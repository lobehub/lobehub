import { type SidebarAgentItem, type SidebarAgentListResponse } from '@/database/repositories/home';
import { lambdaClient } from '@/libs/trpc/client';

export interface HomeDailyBriefPair {
  hint: string;
  welcome: string;
}

export interface HomeDailyBriefResponse {
  pairs: HomeDailyBriefPair[];
}

export class HomeService {
  /**
   * Get sidebar agent list with pinned, grouped, and ungrouped items
   */
  getSidebarAgentList = (): Promise<SidebarAgentListResponse> => {
    return lambdaClient.home.getSidebarAgentList.query({ includeInbox: true });
  };

  /**
   * Get daily brief — paired { welcome, hint } objects for the home page.
   * Server returns `{ pairs: [] }` when no data is cached.
   */
  getDailyBrief = (): Promise<HomeDailyBriefResponse> => {
    return lambdaClient.home.getDailyBrief.query();
  };

  /**
   * Search agents by keyword
   */
  searchAgents = (keyword: string): Promise<SidebarAgentItem[]> => {
    return lambdaClient.home.searchAgents.query({ includeInbox: true, keyword });
  };

  /**
   * Save the drag-and-drop order of the sidebar's pinned rows (the team pins
   * in a workspace, the user's own pins in personal mode).
   */
  updatePinnedOrder = async (ids: string[]): Promise<void> => {
    await lambdaClient.home.updatePinnedOrder.mutate({ ids });
  };

  /**
   * Replace the workspace's recommended Agents / chat groups (owner/admin only).
   */
  updateRecommendedAgents = async (ids: string[]): Promise<void> => {
    await lambdaClient.home.updateRecommendedAgents.mutate({ ids });
  };

  /**
   * Update an agent's session group
   */
  updateAgentSessionGroupId = (agentId: string, sessionGroupId: string | null): Promise<void> => {
    return lambdaClient.home.updateAgentSessionGroupId.mutate({ agentId, sessionGroupId }) as any;
  };
}

export const homeService = new HomeService();
