'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Input, Text } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { IdentityChannel } from './const';
import { identityStyles } from './styles';
import { useAccountActions } from './useIdentityActions';

interface ProvisionCardProps {
  agentId: string;
  channel: IdentityChannel;
  disabled?: boolean;
  onProvisioned: () => Promise<unknown> | void;
}

/**
 * A channel the agent does not have yet: what opening one gives it, an
 * optional handle to ask for, and the one action that opens it.
 *
 * Opening is an explicit, user-initiated act — nothing here provisions on
 * mount, because an address is a commitment (it starts accepting mail) and not
 * a default.
 */
const ProvisionCard = memo<ProvisionCardProps>(({ agentId, channel, disabled, onProvisioned }) => {
  const { t } = useTranslation('setting');
  const [prefix, setPrefix] = useState('');
  const [loading, setLoading] = useState(false);
  const { provision } = useAccountActions({ agentId, onChanged: onProvisioned });

  const handleProvision = async () => {
    setLoading(true);
    try {
      const account = await provision(channel, prefix);
      if (account) setPrefix('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox className={identityStyles.card} gap={10}>
      <Flexbox horizontal align={'flex-start'} gap={12}>
        <Icon className={identityStyles.icon} icon={channel.icon} size={18} />
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text weight={500}>{t(channel.titleKey)}</Text>
          <Text fontSize={12} type={'secondary'}>
            {t(channel.descKey)}
          </Text>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal gap={8}>
        {channel.prefixable && (
          <Input
            disabled={disabled || loading}
            placeholder={t('identity.prefix.placeholder')}
            value={prefix}
            variant={'filled'}
            onChange={(e) => setPrefix(e.target.value)}
            onPressEnter={handleProvision}
          />
        )}
        <Button disabled={disabled} loading={loading} type={'fill'} onClick={handleProvision}>
          {t('identity.provision')}
        </Button>
      </Flexbox>
      {channel.prefixable && (
        <Text fontSize={12} type={'secondary'}>
          {t('identity.prefix.hint')}
        </Text>
      )}
    </Flexbox>
  );
});

ProvisionCard.displayName = 'AgentIdentityProvisionCard';

export default ProvisionCard;
