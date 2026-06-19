import { Button } from '@lobehub/ui';
import { useState } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

export default function ShareButton({ documentId }: { documentId: string }) {
  const [updating, setUpdating] = useState(false);
  const { data, mutate } = useSWR(['business/page-share', documentId], () =>
    lambdaClient.pageShare.getShareSettings.query({ id: documentId }),
  );

  const enabled = data?.visibility === 'link';

  return (
    <Button
      loading={updating}
      size="small"
      onClick={async () => {
        setUpdating(true);
        try {
          await lambdaClient.pageShare.updateShareSettings.mutate({
            id: documentId,
            permission: 'read',
            visibility: enabled ? 'private' : 'link',
          });
          await mutate();
        } finally {
          setUpdating(false);
        }
      }}
    >
      {enabled ? 'Отключить ссылку' : 'Опубликовать ссылку'}
    </Button>
  );
}
