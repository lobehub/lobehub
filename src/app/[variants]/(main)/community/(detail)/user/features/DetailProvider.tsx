'use client';

import { type ReactNode } from 'react';
import { createContext, memo, use } from 'react';

import { type MarketUserProfile } from '@/layout/AuthProvider/MarketAuth/types';
import {
  type DiscoverAssistantItem,
  type DiscoverGroupAgentItem,
  type DiscoverUserInfo,
} from '@/types/discover';

export interface UserDetailContextConfig {
  agentCount: number;
  agentGroups?: DiscoverGroupAgentItem[];
  agents: DiscoverAssistantItem[];
  favoriteAgentGroups?: DiscoverGroupAgentItem[];
  favoriteAgents?: DiscoverAssistantItem[];
  forkedAgentGroups?: DiscoverGroupAgentItem[];
  forkedAgents?: DiscoverAssistantItem[];
  groupCount: number;
  isOwner: boolean;
  mobile?: boolean;
  onEditProfile?: (onSuccess?: (profile: MarketUserProfile) => void) => void;
  onStatusChange?: (
    identifier: string,
    action: 'publish' | 'unpublish' | 'deprecate',
    type?: 'agent' | 'group',
  ) => void;
  totalInstalls: number;
  user: DiscoverUserInfo;
}

export const UserDetailContext = createContext<UserDetailContextConfig | null>(null);

export const UserDetailProvider = memo<{ children: ReactNode; config: UserDetailContextConfig }>(
  ({ children, config }) => {
    return <UserDetailContext value={config}>{children}</UserDetailContext>;
  },
);

export const useUserDetailContext = () => {
  const context = use(UserDetailContext);
  if (!context) {
    throw new Error('useUserDetailContext must be used within UserDetailProvider');
  }
  return context;
};
