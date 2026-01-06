import { Button } from '@lobehub/ui';
import { memo } from 'react';

import { useActionSWR } from '@/libs/swr';
import { useSessionStore } from '@/store/session';

const AddButton = memo(() => {
  const createSession = useSessionStore((s) => s.createSession);
  const { mutate, isValidating } = useActionSWR(['session.createSession', undefined], () => {
    return createSession({ group: undefined });
  });

  return (
    <Button
      loading={isValidating}
      onClick={() => mutate()}
      style={{
        alignItems: 'center',
        borderRadius: 4,
        height: '20px',
        justifyContent: 'center',
        padding: '0 1px',
        width: '20px',
      }}
      variant={'filled'}
    >
      +
    </Button>
  );
});

export default AddButton;
