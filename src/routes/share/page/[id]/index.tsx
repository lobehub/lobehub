'use client';

import { Center } from '@lobehub/ui';
import { memo } from 'react';
import { useParams } from 'react-router';
import useSWR from 'swr';

import PublishedShell from '@/business/client/features/PageShare/PublishedShell';
import ReadOnlyPageViewer from '@/business/client/features/PageShare/ReadOnlyPageViewer';
import Loading from '@/components/Loading/BrandTextLoading';
import { shareKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { getIdFromIdentifier } from '@/utils/identifier';

const SharePagePage = memo(() => {
  const { id } = useParams<{ id: string }>();
  const documentId = getIdFromIdentifier(id ?? '', 'docs');

  const { data, error, isLoading } = useSWR(
    documentId ? shareKeys.pageDocument(documentId) : null,
    () => lambdaClient.pageShare.getSharedDocument.query({ documentId }),
    { revalidateOnFocus: false },
  );

  if (!error && isLoading) {
    return (
      <Center height={'100vh'}>
        <Loading debugId="SharePagePage" />
      </Center>
    );
  }

  return (
    <PublishedShell data={data} error={error}>
      {data ? <ReadOnlyPageViewer data={data} /> : null}
    </PublishedShell>
  );
});

SharePagePage.displayName = 'SharePagePage';

export default SharePagePage;
