'use client';

import { useParams } from 'react-router';

import AgentDocumentReader from '@/features/AgentDocumentReader';
import { getIdFromIdentifier } from '@/utils/identifier';

import { enableWorkbenchIdentity } from '../../../../shell/workbenchReplicaScope';

// A private route: the reader paints its last-read body from disk while the
// session check confirms who is signed in.
void enableWorkbenchIdentity();

const AgentDocumentReaderRoute = () => {
  const { aid = '', docId = '' } = useParams<{ aid: string; docId: string }>();
  const agentId = getIdFromIdentifier(aid, 'agt');
  const documentId = getIdFromIdentifier(docId, 'docs');

  return <AgentDocumentReader agentId={agentId} documentId={documentId} />;
};

export default AgentDocumentReaderRoute;
