import { isDesktop } from '@lobechat/const';
import urlJoin from 'url-join';

import { CLAUDE_CODE_TOKEN_CRED_KEY } from '@/helpers/claudeCodeTokenCred';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useCredsForContext } from '@/hooks/useScopedCreds';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

interface HeteroAgentCloudConfig {
  goToConfig: () => void;
  isConfigured: boolean;
}

export const useHeteroAgentCloudConfig = (agentId: string): HeteroAgentCloudConfig => {
  const router = useQueryRoute();

  const heterogeneousProvider = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider,
  );

  // Only claude-code agents require a cloud credential — codex and other providers do not use this key
  const isClaudeCode = heterogeneousProvider?.type === 'claude-code';
  const needsCredCheck = !isDesktop && isClaudeCode;

  // Only fetch credentials when actually needed. `listForContext` resolves the
  // same scope the cloud run reads (the workspace's organization view inside a
  // workspace, the personal vault otherwise) — the personal list would report
  // a token the run can't see.
  const {
    data: contextCreds,
    error: credsError,
    isLoading: isCredsLoading,
  } = useCredsForContext(needsCredCheck);

  // isConfigured is true when:
  // 1. Running on desktop (local execution, no cloud creds needed), or
  // 2. No heterogeneous provider on this agent, or
  // 3. Provider is not claude-code (e.g. codex — no cloud credential required), or
  // 4. The CLAUDE_CODE_OAUTH_TOKEN credential exists in the run's scope. The
  //    agent's CLAUDE_CODE_CRED_KEY env reference alone doesn't count: the
  //    runtime only reads the credential itself.
  // 5. The credential lookup failed — the state is unknown, not missing, and
  //    editing credentials can't fix a failed request; the run reports a
  //    genuinely missing token itself, or
  // 6. Credentials are still loading — treat as configured to avoid a flash of the
  //    "not configured" alert that immediately disappears once the query resolves
  const hasCredInScope = (contextCreds ?? []).some((c) => c.key === CLAUDE_CODE_TOKEN_CRED_KEY);
  const isConfigured = !needsCredCheck || hasCredInScope || !!credsError || isCredsLoading;

  const goToConfig = () => {
    if (agentId) {
      router.push(urlJoin('/agent', agentId, 'profile'));
    }
  };

  return { goToConfig, isConfigured };
};
