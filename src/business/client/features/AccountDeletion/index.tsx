'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { Input } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

export default function AccountDeletion() {
  const { t } = useTranslation('setting');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Flexbox gap={12} style={{ maxWidth: 420 }}>
      <Text strong>{t('danger.clear.confirm')}</Text>
      <Text type="secondary">
        Deleting your account blocks reusing the same phone/email for another free trial.
      </Text>
      <Input
        placeholder="Confirm your email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button
        danger
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await lambdaClient.accountDeletion.requestDeletion.mutate({
              confirmEmail: email || undefined,
            });
            toast.success('Account deleted');
            window.location.href = '/signin';
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Deletion failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        Delete account
      </Button>
    </Flexbox>
  );
}
