'use client';

import { createContext, memo, type ReactNode, use } from 'react';

import {
  type DiscoverAssistantItem,
  type DiscoverGroupAgentItem,
  type DiscoverPluginItem,
  type DiscoverSkillItem,
  type DiscoverUserInfo,
} from '@/types/discover';

export interface WorkspaceDetailContextConfig {
  agentCount: number;
  agentGroups?: DiscoverGroupAgentItem[];
  agents: DiscoverAssistantItem[];
  canEdit: boolean;
  groupCount: number;
  isLoading?: boolean;
  mobile?: boolean;
  onEditWorkspaceProfile?: () => void;
  onRefreshProfile?: () => Promise<void>;
  plugins?: DiscoverPluginItem[];
  skills?: DiscoverSkillItem[];
  totalInstalls: number;
  user: DiscoverUserInfo;
}

export const WorkspaceDetailContext = createContext<WorkspaceDetailContextConfig | null>(null);

export const WorkspaceDetailProvider = memo<{
  children: ReactNode;
  config: WorkspaceDetailContextConfig;
}>(({ children, config }) => {
  return <WorkspaceDetailContext value={config}>{children}</WorkspaceDetailContext>;
});

export const useWorkspaceDetailContext = () => {
  const context = use(WorkspaceDetailContext);
  if (!context) {
    throw new Error('useWorkspaceDetailContext must be used within WorkspaceDetailProvider');
  }
  return context;
};
