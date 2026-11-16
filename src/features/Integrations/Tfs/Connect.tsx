'use client';

import { Button, Flexbox, Input, InputPassword, Select, Text, useModalContext } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { tfsService } from '@/services/tfs';
import { tfsActions } from '@/store/tfs/action';

export const TfsConnect = ({ collection }: { collection: string }) => {
  const { t } = useTranslation('integration');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const [authType, setAuthType] = useState<'ntlm' | 'pat'>('ntlm');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const connect = async () => {
    setBusy(true);
    setError(undefined);
    setCanDismissByClickOutside(false);
    try {
      await tfsService.connect({ authType, secret, username });
      setSecret('');
      await tfsActions.clear();
      await tfsActions.refresh({ kind: 'status' });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(t('tfs.connectFailed')));
    } finally {
      setBusy(false);
      setCanDismissByClickOutside(true);
    }
  };
  return (
    <Flexbox gap={16} padding={16}>
      <Text>{collection}</Text>
      <Text type="secondary">{t('tfs.personalHint')}</Text>
      <Select
        aria-label={t('tfs.authType')}
        value={authType}
        options={[
          { label: 'NTLM', value: 'ntlm' },
          { label: 'PAT', value: 'pat' },
        ]}
        onChange={(value) => {
          setAuthType(value as 'ntlm' | 'pat');
          setSecret('');
        }}
      />
      {authType === 'ntlm' && (
        <Input
          aria-label={t('tfs.username')}
          autoComplete="username"
          placeholder={t('tfs.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      )}
      <InputPassword
        aria-label={t(authType === 'pat' ? 'tfs.pat' : 'tfs.secret')}
        autoComplete="new-password"
        placeholder={t(authType === 'pat' ? 'tfs.pat' : 'tfs.secret')}
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      {error && <AsyncError error={error} onRetry={() => void connect()} />}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={busy} onClick={close}>
          {t('tfs.cancel')}
        </Button>
        <Button
          disabled={!secret || (authType === 'ntlm' && !username.trim())}
          loading={busy}
          type="primary"
          onClick={() => void connect()}
        >
          {t('tfs.connect')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};
