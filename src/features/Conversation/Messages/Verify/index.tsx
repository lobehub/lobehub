'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { CheckerDock, RunArtifact } from '@/features/Verify';

import { dataSelectors, useConversationStore } from '../../store';

interface VerifyMessageProps {
  id: string;
  index: number;
}

/**
 * Renders a `role='verify'` message — the Agent Run delivery-checker card. The
 * run's `operationId` is carried on `metadata.verifyOperationId`; the inner
 * components read the plan + results off it. Unlike assistant/user messages this
 * is a standalone card group (no avatar bubble): the Run Artifact snapshot on
 * top, the live checker dock below.
 */
const VerifyMessage = memo<VerifyMessageProps>(({ id }) => {
  const item = useConversationStore(dataSelectors.getDisplayMessageById(id), isEqual);
  const operationId = item?.metadata?.verifyOperationId;
  const round = item?.metadata?.verifyRound ?? 1;

  if (!operationId) return null;

  return (
    <Flexbox gap={12} paddingBlock={8}>
      <RunArtifact operationId={operationId} round={round} />
      <CheckerDock operationId={operationId} />
    </Flexbox>
  );
});

VerifyMessage.displayName = 'VerifyMessage';

export default VerifyMessage;
