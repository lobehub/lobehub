import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { useState } from 'react';

import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';

export default function AccountDeletion() {
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const logout = useUserStore((s) => s.logout);

  return (
    <Flexbox gap={12}>
      <Text weight={600}>Удаление аккаунта</Text>
      <Text type="secondary">
        Операция удалит текущего пользователя и связанные данные через каскады базы данных. Для
        подтверждения введите DELETE_MY_ACCOUNT.
      </Text>
      <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
      <Button
        danger
        disabled={confirmation !== 'DELETE_MY_ACCOUNT'}
        loading={deleting}
        onClick={async () => {
          setDeleting(true);
          try {
            await lambdaClient.accountDeletion.deleteCurrentUser.mutate({
              confirmation: 'DELETE_MY_ACCOUNT',
            });
            await logout();
          } finally {
            setDeleting(false);
          }
        }}
      >
        Удалить аккаунт
      </Button>
    </Flexbox>
  );
}
