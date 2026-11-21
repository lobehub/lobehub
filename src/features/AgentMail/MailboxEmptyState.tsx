'use client';

import { Button, Empty, Flexbox, Input, Text } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { IdentityChannel } from './const';
import { useAccountActions } from './useIdentityActions';

interface MailboxEmptyStateProps {
  agentId: string;
  channel: IdentityChannel;
  /** Read-only viewer: the absence is stated, but there is nothing to open. */
  disabled?: boolean;
  onProvisioned: () => Promise<unknown> | void;
}

/**
 * The mail page of an agent with no address: what opening one gives it, the
 * prefix to ask for, and the one action that opens it.
 *
 * Opening is an explicit, user-initiated act — nothing here provisions on
 * mount, because an address is a commitment (it starts accepting mail) and not
 * a default.
 */
const MailboxEmptyState = memo<MailboxEmptyStateProps>(
  ({ agentId, channel, disabled, onProvisioned }) => {
    const { t } = useTranslation('setting');
    const [prefix, setPrefix] = useState('');
    const [loading, setLoading] = useState(false);
    const [failure, setFailure] = useState<string>();
    const { provision } = useAccountActions({
      agentId,
      onChanged: onProvisioned,
      onProvisionFailed: setFailure,
    });
    // Without a prefix the provider would mint an address nobody chose.
    const empty = channel.prefixable && !prefix.trim();

    const handleProvision = async () => {
      if (empty || loading) return;
      setFailure(undefined);
      setLoading(true);
      try {
        await provision(channel, prefix);
      } finally {
        setLoading(false);
      }
    };

    const form = (
      <Flexbox gap={12} style={{ maxWidth: '100%' }} width={360}>
        {channel.prefixable && (
          <Flexbox gap={6}>
            <Input
              aria-label={t('identity.prefix.required')}
              disabled={loading}
              placeholder={t('identity.prefix.required')}
              size={'large'}
              suffix={<Text type={'secondary'}>{channel.addressSuffix}</Text>}
              value={prefix}
              variant={'filled'}
              onPressEnter={handleProvision}
              onChange={(e) => {
                setPrefix(e.target.value);
                setFailure(undefined);
              }}
            />
            {failure ? (
              <Text fontSize={12} role={'alert'} type={'danger'}>
                {failure}
              </Text>
            ) : (
              <Text fontSize={12} type={'secondary'}>
                {t('identity.prefix.requiredHint')}
              </Text>
            )}
          </Flexbox>
        )}
        <Button
          block
          disabled={empty}
          loading={loading}
          size={'large'}
          type={empty ? 'fill' : 'primary'}
          onClick={handleProvision}
        >
          {t('identity.empty.open')}
        </Button>
      </Flexbox>
    );

    return (
      <Empty
        action={disabled ? undefined : form}
        description={t(channel.descKey)}
        emoji={'📬'}
        imageSize={72}
        title={t(disabled ? 'identity.empty.readOnly' : 'identity.empty.title')}
        titleProps={{ fontSize: 20, weight: 600 }}
      />
    );
  },
);

MailboxEmptyState.displayName = 'AgentMailboxEmptyState';

export default MailboxEmptyState;
