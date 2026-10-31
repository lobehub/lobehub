'use client';

import { type TopicPopupInfo } from '@lobechat/electron-client-ipc';
import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ExternalLinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ensureElectronIpc } from '@/utils/electron/ipc';

const styles = stylex.create({
  description: {
    maxWidth: '360px',
    fontSize: '14px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  title: { marginBlock: '0', fontSize: '18px', fontWeight: 600, color: cssVar.colorText },
  wrapper: { width: '100%', height: '100%', padding: '24px' },
});

interface TopicInPopupGuardProps {
  popup: TopicPopupInfo;
}

const TopicInPopupGuard = memo<TopicInPopupGuardProps>(({ popup }) => {
  const { t } = useTranslation('topic');

  const handleFocus = async () => {
    try {
      await ensureElectronIpc().windows.focusTopicPopup({ identifier: popup.identifier });
    } catch (error) {
      console.error('[TopicInPopupGuard] Failed to focus popup window:', error);
    }
  };

  return (
    <Flexbox
      align={'center'}
      className={stylex.props(styles.wrapper).className}
      flex={1}
      gap={16}
      justify={'center'}
      width={'100%'}
    >
      <h2 {...stylex.props(styles.title)}>{t('inPopup.title')}</h2>
      <p {...stylex.props(styles.description)}>{t('inPopup.description')}</p>
      <Button icon={ExternalLinkIcon} type={'primary'} onClick={handleFocus}>
        {t('inPopup.focus')}
      </Button>
    </Flexbox>
  );
});

TopicInPopupGuard.displayName = 'TopicInPopupGuard';

export default TopicInPopupGuard;
