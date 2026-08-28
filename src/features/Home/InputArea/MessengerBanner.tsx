'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageCircleIcon } from 'lucide-react';
import type { FC } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { getPlatformIcon } from '@/routes/(main)/agent/channel/const';

import { InputBanner } from './InputBanner';

// Bump this id when the banner content changes so dismissing the old
// variant does not hide the new one.
export const MESSENGER_BANNER_ID = 'messenger-v1';

const ICON_SIZE = 16;
const AVATAR_SIZE = 24;

// Platforms supported by the Messenger feature (see src/features/Messenger/constants.tsx).
const BANNER_PLATFORM_NAMES = ['Discord', 'Slack', 'Telegram', 'WeChat'] as const;

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatar: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: ${AVATAR_SIZE}px;
    height: ${AVATAR_SIZE}px;
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
    box-shadow:
      0 0 8px -2px rgb(0 0 0 / 5%),
      0 0 0 1px ${cssVar.colorFillTertiary};
  `,
  icon: css`
    color: ${cssVar.colorTextSecondary};
  `,
  iconGroup: css`
    display: flex;
    align-items: center;
  `,
  text: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const MessengerBanner = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();

  const platformIcons = useMemo(() => {
    const icons: Array<{ Icon: FC<any>; key: string }> = [];

    for (const name of BANNER_PLATFORM_NAMES) {
      const PlatformIcon = getPlatformIcon(name);
      if (!PlatformIcon) continue;
      const ColorIcon =
        'Color' in PlatformIcon
          ? ((PlatformIcon as any).Color as FC<any>)
          : (PlatformIcon as FC<any>);
      icons.push({ Icon: ColorIcon, key: name });
    }

    return icons;
  }, []);

  const handleNavigateToMessenger = useCallback(() => {
    navigate('/settings/messenger');
  }, [navigate]);

  return (
    <InputBanner
      dismissId={MESSENGER_BANNER_ID}
      dismissTitle={t('messengerBanner.dismiss')}
      testId={'messenger-banner'}
      onClick={handleNavigateToMessenger}
    >
      <Flexbox horizontal align={'center'} flex={1} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon className={styles.icon} icon={MessageCircleIcon} size={18} />
          <span className={styles.text}>{t('messengerBanner.title')}</span>
        </Flexbox>
        {platformIcons.length > 0 && (
          <div className={styles.iconGroup}>
            {platformIcons.map(({ Icon: PlatformIcon, key }, index) => (
              <div
                className={styles.avatar}
                key={key}
                style={{ marginLeft: index === 0 ? 0 : -6, zIndex: index }}
              >
                <PlatformIcon size={ICON_SIZE} />
              </div>
            ))}
          </div>
        )}
      </Flexbox>
    </InputBanner>
  );
});

MessengerBanner.displayName = 'MessengerBanner';

export default MessengerBanner;
