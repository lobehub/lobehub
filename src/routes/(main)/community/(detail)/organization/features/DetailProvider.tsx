'use client';

import { createContext, memo, type ReactNode, use } from 'react';

import type {
  DiscoverAssistantItem,
  DiscoverGroupAgentItem,
  DiscoverPluginItem,
  DiscoverSkillItem,
  DiscoverUserInfo,
} from '@/types/discover';

export interface OrganizationDetailContextConfig {
  agentCount: number;
  agentGroups?: DiscoverGroupAgentItem[];
  agents: DiscoverAssistantItem[];
  groupCount: number;
  mobile?: boolean;
  plugins?: DiscoverPluginItem[];
  skills?: DiscoverSkillItem[];
  totalInstalls: number;
  user: DiscoverUserInfo;
}

export const OrganizationDetailContext = createContext<OrganizationDetailContextConfig | null>(
  null,
);

export const OrganizationDetailProvider = memo<{
  children: ReactNode;
  config: OrganizationDetailContextConfig;
}>(({ children, config }) => {
  return <OrganizationDetailContext value={config}>{children}</OrganizationDetailContext>;
});

export const useOrganizationDetailContext = () => {
  const context = use(OrganizationDetailContext);
  if (!context) {
    throw new Error('useOrganizationDetailContext must be used within OrganizationDetailProvider');
  }
  return context;
};
