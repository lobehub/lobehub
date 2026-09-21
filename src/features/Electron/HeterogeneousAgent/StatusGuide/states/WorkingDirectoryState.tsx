import { Text } from '@lobehub/ui/base-ui';
import { FolderX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import GuideActions from '../GuideActions';
import GuideShell from '../GuideShell';
import type { HeterogeneousAgentGuideStateProps } from '../types';

const WorkingDirectoryState = ({ error, onRetry, variant }: HeterogeneousAgentGuideStateProps) => {
  const { t } = useTranslation('chat');

  return (
    <GuideShell
      headerDescription={<Text type="secondary">{t('workingDirectoryGuide.desc')}</Text>}
      icon={<FolderX size={24} />}
      title={t('workingDirectoryGuide.title')}
      variant={variant}
      actions={
        <GuideActions
          retryPrimary
          retryLabel={t('workingDirectoryGuide.actions.retry')}
          onRetry={onRetry}
        />
      }
    >
      {error?.workingDirectory && <Text code>{error.workingDirectory}</Text>}
      <Text style={{ fontSize: 12 }} type="secondary">
        {t('workingDirectoryGuide.hint')}
      </Text>
    </GuideShell>
  );
};

export default WorkingDirectoryState;
