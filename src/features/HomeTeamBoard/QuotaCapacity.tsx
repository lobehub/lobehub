import { Button } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import {
  isSubscriptionProvider,
  sortAccounts,
  type SubscriptionProvider,
} from '@/features/SubscriptionAccounts/accountView';
import QuotaCalendar from '@/features/SubscriptionAccounts/QuotaCalendar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { agentQuotaSelectors, type QuotaAccount, useAgentQuotaStore } from '@/store/agentQuota';

type ProviderAccount = QuotaAccount & { provider: SubscriptionProvider };

/**
 * The team's coding-agent subscriptions as a capacity calendar, under the run
 * board: what the team can hand work to over the coming days. A workspace with
 * no subscription accounts has nothing to plan against, so it shows nothing.
 */
const QuotaCapacity = () => {
  const { t } = useTranslation('setting');
  const useFetchQuotaAccounts = useAgentQuotaStore((s) => s.useFetchQuotaAccounts);
  useFetchQuotaAccounts();
  const loaded = useAgentQuotaStore(agentQuotaSelectors.accounts);
  // Taking accounts in or out of rotation is an admin decision, as on the settings page.
  const { allowed: canManage } = usePermission('manage_settings');
  const navigate = useWorkspaceAwareNavigate();

  const accounts = sortAccounts(
    (loaded ?? []).filter((a): a is ProviderAccount => isSubscriptionProvider(a.provider)),
  );
  if (accounts.length === 0) return null;

  return (
    <QuotaCalendar
      accounts={accounts}
      extra={
        canManage && (
          <Button size={'small'} onClick={() => navigate('/settings/subscription-accounts')}>
            {t('subscriptionAccounts.calendar.manage')}
          </Button>
        )
      }
    />
  );
};

export default QuotaCapacity;
