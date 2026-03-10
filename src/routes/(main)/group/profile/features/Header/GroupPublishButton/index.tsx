import isEqual from 'fast-deep-equal';
import { memo, useCallback, useState } from 'react';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import GroupPublishResultModal from './GroupPublishResultModal';
import PublishButton from './PublishButton';

/**
 * Group Publish Button Component
 *
 * Simplified version - backend handles ownership check automatically.
 * The action type (submit vs upload) is determined by backend based on:
 * 1. Whether the identifier exists
 * 2. Whether the current user is the owner
 */
const GroupPublishButton = memo(() => {
  const currentGroup = useAgentGroupStore(agentGroupSelectors.currentGroup, isEqual);

  const [showResultModal, setShowResultModal] = useState(false);
  const [publishedIdentifier, setPublishedIdentifier] = useState<string>();

  const handlePublishSuccess = useCallback((identifier: string) => {
    setPublishedIdentifier(identifier);
    setShowResultModal(true);
  }, []);

  // Determine action based on whether we have an existing marketIdentifier
  // Backend will verify ownership and decide to create new or update
  // marketIdentifier is stored at top-level (same as agents)
  const action = currentGroup?.marketIdentifier ? 'upload' : 'submit';

  return (
    <>
      <PublishButton action={action} onPublishSuccess={handlePublishSuccess} />
      <GroupPublishResultModal
        identifier={publishedIdentifier}
        open={showResultModal}
        onCancel={() => setShowResultModal(false)}
      />
    </>
  );
});

export default GroupPublishButton;
