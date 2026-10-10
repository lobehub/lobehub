'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import AccountCard from './AccountCard';
import { IDENTITY_CHANNELS, isChannelAccount, isUnchanneledAccount } from './const';
import InlineError from './InlineError';
import ProvisionCard from './ProvisionCard';
import SectionHeader from './SectionHeader';
import { useAgentAccounts } from './useAgentIdentity';

interface IdentityAccountsProps {
  agentId: string;
  disabled?: boolean;
}

/**
 * The addresses the agent owns.
 *
 * Every channel is rendered either as the address that exists or as the offer
 * to open one — never as a plain list that silently omits a channel, so "the
 * agent has no phone number" is visible rather than inferred from absence.
 */
const IdentityAccounts = memo<IdentityAccountsProps>(({ agentId, disabled }) => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading, mutate } = useAgentAccounts(agentId);
  const providers = useServerConfigStore(serverConfigSelectors.agentIdentityProviders);

  const header = <SectionHeader desc={t('identity.desc')} title={t('identity.title')} />;

  if (error) {
    return (
      <Flexbox gap={10}>
        {header}
        <InlineError
          detail={error instanceof Error ? error.message : String(error)}
          summary={t('identity.loadFailed')}
          onRetry={() => void mutate()}
        />
      </Flexbox>
    );
  }

  if (isLoading && !data) {
    return (
      <Flexbox gap={10}>
        {header}
        <Skeleton height={56} width={'100%'} />
        <Skeleton height={88} width={'100%'} />
      </Flexbox>
    );
  }

  const accounts = (data ?? []).filter((account) => account.status !== 'revoked');

  return (
    <Flexbox gap={10}>
      {header}
      {IDENTITY_CHANNELS.map((channel) => {
        const owned = accounts.filter((account) => isChannelAccount(account, channel));

        if (owned.length === 0) {
          // An offer this deployment cannot fulfil would only fail on click.
          if (!providers.includes(channel.provider)) return null;

          return (
            <ProvisionCard
              agentId={agentId}
              channel={channel}
              disabled={disabled}
              key={channel.provider}
              onProvisioned={mutate}
            />
          );
        }

        return owned.map((account) => (
          <AccountCard
            account={account}
            agentId={agentId}
            channel={channel}
            disabled={disabled}
            key={account.id}
            onChanged={mutate}
          />
        ));
      })}
      {/* Mounted addresses (and providers this tab does not offer) still belong
          to the agent: show them so they can be read, copied and released. */}
      {accounts.filter(isUnchanneledAccount).map((account) => (
        <AccountCard
          account={account}
          agentId={agentId}
          disabled={disabled}
          key={account.id}
          onChanged={mutate}
        />
      ))}
    </Flexbox>
  );
});

IdentityAccounts.displayName = 'AgentIdentityAccounts';

export default IdentityAccounts;
