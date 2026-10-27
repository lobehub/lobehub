import { Button, Flexbox, Text } from '@lobehub/ui';
import { FolderX, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import GuideActions from '../GuideActions';
import GuideShell from '../GuideShell';
import type { HeterogeneousAgentGuideStateProps } from '../types';

const WorkingDirectoryState = ({
  error,
  onRetry,
  variant,
  workingDirectoryReset,
}: HeterogeneousAgentGuideStateProps) => {
  const { t } = useTranslation('chat');
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    if (!workingDirectoryReset || resetting) return;
    setResetting(true);
    try {
      await workingDirectoryReset.onReset();
    } finally {
      setResetting(false);
    }
  };

  return (
    <GuideShell
      headerDescription={<Text type="secondary">{t('workingDirectoryGuide.desc')}</Text>}
      icon={<FolderX size={24} />}
      title={t('workingDirectoryGuide.title')}
      variant={variant}
      actions={
        workingDirectoryReset ? (
          // A deleted worktree has one real way out — back to the source repo —
          // so it leads; a bare retry would only spawn in the dead checkout again.
          <Flexbox horizontal gap={8} justify="flex-end">
            <Button
              icon={<Undo2 size={14} />}
              loading={resetting}
              type="primary"
              onClick={handleReset}
            >
              {t('workingDirectoryGuide.actions.resetToSource', {
                name: workingDirectoryReset.name,
              })}
            </Button>
          </Flexbox>
        ) : (
          <GuideActions
            retryPrimary
            retryLabel={t('workingDirectoryGuide.actions.retry')}
            onRetry={onRetry}
          />
        )
      }
    >
      {error?.workingDirectory && <Text code>{error.workingDirectory}</Text>}
      <Text style={{ fontSize: 12 }} type="secondary">
        {t(
          workingDirectoryReset
            ? 'workingDirectoryGuide.worktreeHint'
            : 'workingDirectoryGuide.hint',
        )}
      </Text>
    </GuideShell>
  );
};

export default WorkingDirectoryState;
