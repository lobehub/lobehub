'use client';

import { memo, Suspense } from 'react';
import { useParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import AgentDocumentPage from '@/features/AgentDocumentPage';
import { getIdFromIdentifier } from '@/utils/identifier';

const AgentDocumentRoute = memo(() => {
  const { docId } = useParams<{ docId: string }>();
  const documentId = getIdFromIdentifier(docId ?? '', 'docs');

  return (
    <Suspense fallback={<Loading debugId="AgentDocumentRoute" />}>
      {/* key remounts the editor when switching between documents */}
      <AgentDocumentPage documentId={documentId} key={documentId} />
    </Suspense>
  );
});

AgentDocumentRoute.displayName = 'AgentDocumentRoute';

export default AgentDocumentRoute;
