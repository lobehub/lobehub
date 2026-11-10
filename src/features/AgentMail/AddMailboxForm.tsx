'use client';

import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentAccountView } from '@/services/agentAccount';

import type { IdentityChannel } from './const';
import { useAccountActions } from './useIdentityActions';

interface AddMailboxFormProps {
  agentId: string;
  channel: IdentityChannel;
  onAdded: (account: AgentAccountView) => void;
  onChanged: () => Promise<unknown> | void;
}

/**
 * Open one more address: only the part the user chooses is asked for. The
 * prefix is required, because without one the provider hands back the first
 * mailbox instead of opening another.
 */
const AddMailboxForm = ({ agentId, channel, onAdded, onChanged }: AddMailboxFormProps) => {
  const { t } = useTranslation('setting');
  const [prefix, setPrefix] = useState('');
  const [loading, setLoading] = useState(false);
  const { provision } = useAccountActions({ agentId, onChanged });
  const empty = !prefix.trim();

  const submit = async () => {
    if (empty || loading) return;
    setLoading(true);
    try {
      const account = await provision(channel, prefix);
      if (account) onAdded(account);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={8}>
      <Input
        autoFocus
        disabled={loading}
        placeholder={t('identity.prefix.required')}
        size={'large'}
        suffix={<Text type={'secondary'}>{channel.addressSuffix}</Text>}
        value={prefix}
        variant={'filled'}
        onChange={(event) => setPrefix(event.target.value)}
        onPressEnter={submit}
      />
      <Text fontSize={12} type={'secondary'}>
        {t('identity.prefix.requiredHint')}
      </Text>
      <Flexbox horizontal justify={'flex-end'} paddingBlock={'8px 0'}>
        <Button disabled={empty} loading={loading} type={'primary'} onClick={submit}>
          {t('identity.provision')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default AddMailboxForm;
