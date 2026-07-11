'use client';

import { DOWNLOAD_URL } from '@lobechat/const';
import { ClaudeCode, Codex } from '@lobehub/icons';
import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

const LocalAgentsPanel = memo(() => {
  const { t } = useTranslation('onboarding');

  return (
    <Flexbox className={styles.localAgentsPanel} gap={12}>
      <Flexbox gap={2}>
        <Text className={styles.sectionTitle}>{t('flow.steps.messenger.localAgents.title')}</Text>
        <Text className={styles.sectionHint}>{t('flow.steps.messenger.localAgents.subtitle')}</Text>
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        gap={16}
        justify={'space-between'}
        style={{ flexWrap: 'wrap' }}
      >
        <Flexbox horizontal align={'center'} gap={12}>
          <div className={styles.localAgentsIconStrip}>
            <div className={styles.localAgentsIconTile}>
              <ClaudeCode.Avatar size={20} />
            </div>
            <div className={styles.localAgentsIconTile}>
              <Codex.Avatar size={20} />
            </div>
          </div>
          <Text className={styles.localAgentsNote}>
            {t('flow.steps.messenger.localAgents.note')}
          </Text>
        </Flexbox>
        <Button
          href={DOWNLOAD_URL.default}
          rel={'noopener noreferrer'}
          shape={'round'}
          size={'small'}
          target={'_blank'}
        >
          {t('flow.steps.messenger.localAgents.download')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

LocalAgentsPanel.displayName = 'MessengerLocalAgentsPanel';

export default LocalAgentsPanel;
