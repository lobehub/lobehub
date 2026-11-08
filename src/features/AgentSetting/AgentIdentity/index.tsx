'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useStore } from '../store';
import IdentityAccounts from './IdentityAccounts';
import InboxSection from './InboxSection';

/**
 * The identity tab: which addresses this agent owns, and what has arrived.
 *
 * Two sections rather than two tabs, because they answer one question — "is
 * anyone reaching this agent, and through what?" — and the inbox is only
 * meaningful next to the addresses that received it.
 */
const AgentIdentity = memo(() => {
  const { t } = useTranslation('setting');
  const [id, disabled] = useStore((s) => [s.id, s.disabled]);

  if (!id) {
    return (
      <Flexbox flex={1} style={{ color: 'var(--lobe-colors-text-tertiary)', fontSize: 13 }}>
        {t('identity.noAgent')}
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24} paddingBlock={16}>
      <IdentityAccounts agentId={id} disabled={disabled} />
      <InboxSection agentId={id} />
    </Flexbox>
  );
});

AgentIdentity.displayName = 'AgentIdentity';

export default AgentIdentity;
