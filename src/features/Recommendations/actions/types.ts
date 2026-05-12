import type { HeterogeneousCliAgentType, ToolStatus } from '@lobechat/electron-client-ipc';
import type { HeterogeneousAgentClientConfig } from '@lobechat/heterogeneous-agents/client';
import type { SidebarAgentItem } from '@lobechat/types';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';

import type { CreateHeteroAgentOptions } from '@/hooks/useCreateHeteroAgent';

export type HeteroDetectionMap = Partial<Record<HeterogeneousCliAgentType, ToolStatus>>;

export interface ActionContext {
  agents: SidebarAgentItem[];
  createHeteroAgent: (
    definition: HeterogeneousAgentClientConfig,
    options?: CreateHeteroAgentOptions,
  ) => Promise<void>;
  /** Pre-fetched detection results for all hetero CLI types. Empty on web. */
  heteroDetections: HeteroDetectionMap;
  isDesktop: boolean;
  t: TFunction<'home'>;
}

export interface RecommendedAction {
  ctaKey: string;
  descriptionKey: string;
  execute: (ctx: ActionContext) => Promise<void>;
  /** i18n interpolation values for title/description/cta */
  i18nValues?: Record<string, string>;
  icon: ReactNode;
  id: string;
  isEligible: (ctx: ActionContext) => boolean;
  /** Higher = shown earlier. Defaults to 0. */
  priority?: number;
  tagKey?: string;

  titleKey: string;
}
