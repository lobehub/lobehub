import { type SidebarAgentItem, type SidebarAgentListResponse } from '@/database/repositories/home';
import { lambdaClient } from '@/libs/trpc/client';

export class HomeService {
  /**
   * Get sidebar agent list with pinned, grouped, and ungrouped items
   */
  getSidebarAgentList = (): Promise<SidebarAgentListResponse> => {
    return lambdaClient.home.getSidebarAgentList.query();
  };

  /**
   * Search agents by keyword
   */
  searchAgents = (keyword: string): Promise<SidebarAgentItem[]> => {
    return lambdaClient.home.searchAgents.query({ keyword });
  };

  /**
   * Update an agent's session group
   */
  updateAgentSessionGroupId = (agentId: string, sessionGroupId: string | null): Promise<void> => {
    return lambdaClient.home.updateAgentSessionGroupId.mutate({ agentId, sessionGroupId }) as any;
  };
}

export const homeService = new HomeService();
