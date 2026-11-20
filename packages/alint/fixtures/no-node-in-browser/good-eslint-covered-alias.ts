// Fixture: workspace aliases are ESLint's job; this rule leaves them alone.
import { type SidebarAgentItem } from '@/database/repositories/home';
import { lambdaClient } from '@/libs/trpc/client';

export const fetchSidebarAgents = (): Promise<SidebarAgentItem[]> =>
  lambdaClient.home.getSidebarAgents.query();
