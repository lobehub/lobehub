'use client';

import { ActionIcon } from '@lobehub/ui';
import { DownloadIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import useSWR from 'swr';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';

import { clientOnly } from '../../shell/clientOnly';
import ShareLayout from '../../shell/ShareLayout';

// The viewer picks a renderer per file type (PDF, Office, code highlighting…);
// none of it belongs in the worker, and a file has nothing to show before the
// browser fetches its bytes anyway.
const SharedFileBody = clientOnly(() => import('./SharedFileBody.client'));

const SharedFileView = memo(() => {
  const { t } = useTranslation('chat');
  const { id: shareId } = useParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(
    shareId ? shareKeys.file(shareId) : null,
    () => lambdaClient.fileShare.getSharedFile.query({ shareId: shareId! }),
    // Every read counts a view and mints new presigned addresses, so the SSR
    // document's copy is not read again on mount, and a refocus must not swap
    // the source of a video mid-playback.
    { revalidateIfStale: false, revalidateOnFocus: false },
  );

  const loading = isLoading && !data;

  return (
    <ShareLayout
      error={error || (!loading && !data)}
      loading={loading}
      title={data?.file.name}
      actions={
        data && (
          <ActionIcon
            aria-label={t('sharePage.file.download')}
            icon={DownloadIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('sharePage.file.download')}
            // The address answers with `Content-Disposition: attachment`, so
            // navigating to it downloads without leaving the page.
            onClick={() => window.location.assign(data.file.downloadUrl)}
          />
        )
      }
      notFound={{
        desc: t('sharePage.error.fileNotFound.subtitle'),
        title: t('sharePage.error.fileNotFound.title'),
      }}
    >
      {data && <SharedFileBody data={data} />}
    </ShareLayout>
  );
});

SharedFileView.displayName = 'SharedFileView';

export default SharedFileView;
