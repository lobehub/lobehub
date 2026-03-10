import isEqual from 'fast-deep-equal';
import { memo, useCallback, useState } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import PublishButton from './PublishButton';
import PublishResultModal from './PublishResultModal';

/**
 * Agent Publish Button Component
 *
 * Simplified version - backend now handles ownership check automatically.
 * The action type (submit vs upload) is determined by backend based on:
 * 1. Whether the identifier exists
 * 2. Whether the current user is the owner
 */
const AgentPublishButton = memo(() => {
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);

  const [showResultModal, setShowResultModal] = useState(false);
  const [publishedIdentifier, setPublishedIdentifier] = useState<string>();

  const handlePublishSuccess = useCallback((identifier: string) => {
    setPublishedIdentifier(identifier);
    setShowResultModal(true);
  }, []);

  // Determine action based on whether we have an existing marketIdentifier
  // Backend will verify ownership and decide to create new or update
  const action = meta?.marketIdentifier ? 'upload' : 'submit';

  return (
    <>
      <PublishButton action={action} onPublishSuccess={handlePublishSuccess} />
      <PublishResultModal
        identifier={publishedIdentifier}
        open={showResultModal}
        onCancel={() => setShowResultModal(false)}
      />
    </>
  );
});

export default AgentPublishButton;
