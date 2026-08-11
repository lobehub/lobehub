'use client';

import { memo, Suspense } from 'react';
import { useParams } from 'react-router';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import AgentDocumentPage from '@/features/AgentDocumentPage';
import { getIdFromIdentifier } from '@/utils/identifier';

const AgentDocumentRoute = memo(() => {
  const { docId } = useParams<{ docId: string }>();
  const documentId = getIdFromIdentifier(docId ?? '', 'docs');

  return (
    <Suspense fallback={<SurfaceSkeleton variant={'editor'} />}>
      {/* key remounts the editor when switching between documents */}
      <AgentDocumentPage documentId={documentId} key={documentId} />
    </Suspense>
  );
});

AgentDocumentRoute.displayName = 'AgentDocumentRoute';

export default AgentDocumentRoute;
