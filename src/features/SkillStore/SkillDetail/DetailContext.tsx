'use client';

import { type KlavisServerType, type LobehubSkillProviderType } from '@lobechat/const';
import { type Klavis } from 'klavis';
import type React from 'react';
import { createContext, use } from 'react';

export interface DetailContextValue {
  author: string;
  authorUrl?: string;
  config: KlavisServerType | LobehubSkillProviderType;
  description: string;
  icon: string | React.ComponentType<any>;
  identifier: string;
  isConnected: boolean;
  label: string;
  localizedDescription: string;
  localizedReadme: string;
  readme: string;
  serverName?: Klavis.McpServerName;
  tools: Array<{ description?: string; inputSchema?: any; name: string }>;
  toolsLoading: boolean;
}

export const DetailContext = createContext<DetailContextValue | null>(null);

export const useDetailContext = () => {
  const context = use(DetailContext);
  if (!context) {
    throw new Error('useDetailContext must be used within DetailProvider');
  }
  return context;
};
