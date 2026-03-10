import { ActionIcon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Loader2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentOwnershipCheck } from '@/hooks/useAgentOwnershipCheck';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import PublishButton from './PublishButton';
import PublishResultModal from './PublishResultModal';

const AgentPublishButton = memo(() => {
  const { t } = useTranslation('setting');
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const { isOwnAgent } = useAgentOwnershipCheck(meta?.marketIdentifier);

  const [showResultModal, setShowResultModal] = useState(false);
  const [publishedIdentifier, setPublishedIdentifier] = useState<string>();

  const handlePublishSuccess = useCallback((identifier: string) => {
    setPublishedIdentifier(identifier);
    setShowResultModal(true);
  }, []);

  const buttonType = useMemo(() => {
    if (!meta?.marketIdentifier) {
      return 'submit';
    }
    if (isOwnAgent === null) {
      return 'loading';
    }
    if (isOwnAgent === true) {
      return 'upload';
    }
    return 'submit';
  }, [meta?.marketIdentifier, isOwnAgent]);

  const content = useMemo(() => {
    switch (buttonType) {
      case 'upload': {
        return (
          <PublishButton
            action="upload"
            marketIdentifier={meta?.marketIdentifier}
            onPublishSuccess={handlePublishSuccess}
          />
        );
      }

      case 'submit': {
        return (
          <PublishButton
            action="submit"
            marketIdentifier={meta?.marketIdentifier}
            onPublishSuccess={handlePublishSuccess}
          />
        );
      }

      default: {
        return <ActionIcon disabled loading icon={Loader2} title={t('checkingPermissions')} />;
      }
    }
  }, [buttonType, meta?.marketIdentifier]);

  return (
    <>
      {content}
      <PublishResultModal
        identifier={publishedIdentifier}
        open={showResultModal}
        onCancel={() => setShowResultModal(false)}
      />
    </>
  );
});

export default AgentPublishButton;
