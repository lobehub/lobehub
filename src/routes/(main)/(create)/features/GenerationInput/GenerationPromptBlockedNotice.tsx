'use client';

import { Alert, createStaticStyles } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    padding-block-start: 8px;
    padding-inline: 8px;
  `,
}));

interface GenerationPromptBlockedNoticeProps {
  onClose: () => void;
}

/**
 * Shown on top of the prompt input when content moderation rejected the
 * submitted prompt, so the reason sits next to the text the user has to revise.
 */
const GenerationPromptBlockedNotice = memo<GenerationPromptBlockedNoticeProps>(({ onClose }) => {
  const { t } = useTranslation('common');

  return (
    <div className={styles.container}>
      <Alert
        closable={{ onClose }}
        title={t('generation.promptModeration.blocked')}
        type={'error'}
        variant={'soft'}
      />
    </div>
  );
});

GenerationPromptBlockedNotice.displayName = 'GenerationPromptBlockedNotice';

export default GenerationPromptBlockedNotice;
