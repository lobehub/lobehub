'use client';

import { Button, Tag } from '@lobehub/ui';
import { Share2Icon } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import SharePopover from '@/features/PageShare/SharePopover';
import { lambdaClient } from '@/libs/trpc/client';

interface ShareButtonProps {
  documentId: string;
}

const ShareButton: FC<ShareButtonProps> = ({ documentId }) => {
  const { t } = useTranslation('pageShare');
  const { data } = useSWR(
    documentId ? ['document.getShareSettings.header', documentId] : null,
    () => lambdaClient.document.getShareSettings.query({ id: documentId }),
  );

  const isShared = data?.visibility === 'link';

  return (
    <SharePopover documentId={documentId}>
      <Button icon={Share2Icon} size={'small'} type={isShared ? 'primary' : 'default'}>
        {t('shareButton.label')}
        {isShared && (
          <Tag color={'success'} style={{ marginInlineStart: 6 }}>
            {t('shareButton.sharedBadge')}
          </Tag>
        )}
      </Button>
    </SharePopover>
  );
};

export default ShareButton;
