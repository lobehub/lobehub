'use client';

import { memo } from 'react';
import { useParams } from 'react-router';
import useSWR from 'swr';

import PublishedShell from '@/business/client/features/PageShare/PublishedShell';
import ReadOnlyPageViewer from '@/business/client/features/PageShare/ReadOnlyPageViewer';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { getIdFromIdentifier } from '@/utils/identifier';

import ShareLayout from '../../shell/ShareLayout';

const PAGE_READER_WIDTH = 820;

const SharedPageView = memo(() => {
  const { id } = useParams<{ id: string }>();
  const documentId = getIdFromIdentifier(id ?? '', 'docs');

  const { data, error, isLoading } = useSWR(
    documentId ? shareKeys.pageDocument(documentId) : null,
    () => lambdaClient.pageShare.getSharedDocument.query({ documentId }),
    { revalidateOnFocus: false },
  );

  return (
    <ShareLayout
      contentWidth={PAGE_READER_WIDTH}
      error={error}
      // The SSR document already carries the page, and SWR revalidates on mount
      // with it in cache — gating on `isLoading` alone would blank it.
      loading={isLoading && !data}
      title={data?.document.title}
    >
      {data ? (
        <PublishedShell data={data}>
          <ReadOnlyPageViewer data={data} />
        </PublishedShell>
      ) : null}
    </ShareLayout>
  );
});

SharedPageView.displayName = 'SharedPageView';

export default SharedPageView;
