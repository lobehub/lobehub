'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AccountCard from './AccountCard';
import { IDENTITY_CHANNELS } from './const';
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
        const owned = accounts.filter((account) => account.kind === channel.kind);

        if (owned.length === 0) {
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
            key={account.id}
            onChanged={mutate}
          />
        ));
      })}
    </Flexbox>
  );
});

IdentityAccounts.displayName = 'AgentIdentityAccounts';

export default IdentityAccounts;
