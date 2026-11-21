import type { AgentItem } from '@lobechat/types';

import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

export type AgentProfilePreview = Pick<
  AgentItem,
  'avatar' | 'backgroundColor' | 'description' | 'model' | 'name' | 'provider' | 'title'
>;

export interface AgentProfileDetail extends Partial<AgentProfilePreview> {
  agencyConfig?: { heterogeneousProvider?: { type?: string | null } | null } | null;
  files?: unknown[];
  id?: string;
  knowledgeBases?: unknown[];
  plugins?: string[];
}

/**
 * The full agent behind a profile card, read from the agent's config replica:
 * the local copy paints the card at once and an open card confirms it in the
 * background. `enabled` gates both the read and the sync (a closed card, or a
 * viewer who may not configure the agent, gets neither).
 */
export const useAgentProfileDetail = (agentId: string, enabled: boolean) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const useHydrateAgentConfig = useAgentStore((s) => s.useHydrateAgentConfig);
  const { isLoading } = useHydrateAgentConfig(isLogin, enabled ? agentId : '');
  const detail = useAgentStore((s) =>
    enabled ? (s.agentMap[agentId] as AgentProfileDetail | undefined) : undefined,
  );

  return { detail, isLoading };
};
