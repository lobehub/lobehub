import { getAgentProfileTab } from '@/features/AgentProfileTabs/tabOptions';

export const isAgentProfileRoute = (pathname: string) => !!getAgentProfileTab(pathname);
