'use client';

import { Flexbox, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Scale, UsersRound } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import { scrollToAgentQuotaAccounts } from '@/features/AgentQuotaAccounts/anchor';
import AgentAuthorizedAccounts from '@/features/AgentQuotaAccounts/AuthorizedAccounts';
import LoadBalancing from '@/features/AgentQuotaAccounts/LoadBalancing';
import { balancesAccountsOn } from '@/features/AgentQuotaAccounts/loadBalancingTarget';
import { usesAgentQuotaAccounts } from '@/features/AgentQuotaAccounts/supported';
import { useProfileExecutionTarget } from '@/features/HeterogeneousAgent/ExecutionEnvironment/useProfileExecutionTarget';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { WorkspaceAgentPolicyCard } from '../ProfileEditor/WorkspaceAgentPolicyCard';

/**
 * `/agent/:aid/accounts`: which subscription accounts a Claude Code agent may
 * run on, then how its runs are balanced across exactly those accounts.
 */
const AccountsEditor = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentId = useAgentStore((s) => s.activeAgentId || '');
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
  const supported = usesAgentQuotaAccounts(config?.agencyConfig?.heterogeneousProvider);
  // The balancer follows where this caller's new topics run, as on the Environment page.
  const executionTarget = useProfileExecutionTarget(agentId);

  // API-key mode or another agent type has no accounts to pick: its setup lives on Environment.
  useEffect(() => {
    if (agentId && !supported) {
      navigate(buildAgentProfileTabPath(agentId, 'environment'), { replace: true });
    }
  }, [agentId, navigate, supported]);

  if (!supported) return null;

  return (
    <Flexbox gap={32} paddingBlock={'8px 48px'}>
      <Flexbox gap={4}>
        <Text fontSize={24} weight={600}>
          {t('tab.accounts')}
        </Text>
        <Text type={'secondary'}>{t('heteroAgent.agentAccounts.pageDesc')}</Text>
      </Flexbox>
      <Flexbox gap={8} style={{ containerType: 'inline-size' }}>
        <WorkspaceAgentPolicyCard
          fullWidth
          icon={UsersRound}
          title={t('heteroAgent.agentAccounts.title')}
        >
          <AgentAuthorizedAccounts agentId={agentId} disabled={!canEdit} />
        </WorkspaceAgentPolicyCard>
        {balancesAccountsOn(executionTarget.target, executionTarget.deviceId) && (
          <WorkspaceAgentPolicyCard
            fullWidth
            icon={Scale}
            title={t('heteroAgent.agentAccounts.loadBalance')}
          >
            <LoadBalancing
              agentId={agentId}
              deviceId={executionTarget.deviceId}
              disabled={!canEdit}
              onManageAccounts={() => void scrollToAgentQuotaAccounts()}
            />
          </WorkspaceAgentPolicyCard>
        )}
      </Flexbox>
    </Flexbox>
  );
});

AccountsEditor.displayName = 'AccountsEditor';

export default AccountsEditor;
