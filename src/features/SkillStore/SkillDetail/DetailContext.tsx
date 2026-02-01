'use client';

import type { KlavisServerType, LobehubSkillProviderType } from '@lobechat/const';
import type { Klavis } from 'klavis';
import type React from 'react';
import { createContext, useContext } from 'react';

export interface DetailContextValue {
  author: string;
  authorUrl?: string;
  config: KlavisServerType | LobehubSkillProviderType;
  description: string;
  icon: string | React.ComponentType<any>;
  identifier: string;
  introduction: string;
  isConnected: boolean;
  label: string;
  localizedDescription: string;
  localizedIntroduction: string;
  serverName?: Klavis.McpServerName;
  tools: Array<{ description?: string; inputSchema?: any; name: string }>;
  toolsLoading: boolean;
}

export const DetailContext = createContext<DetailContextValue | null>(null);

export const useDetailContext = () => {
  const context = useContext(DetailContext);
  if (!context) {
    throw new Error('useDetailContext must be used within DetailProvider');
  }
  return context;
};
