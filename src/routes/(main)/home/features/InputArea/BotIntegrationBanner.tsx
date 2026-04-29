'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { RadioTowerIcon, X } from 'lucide-react';
import type { FC } from 'react';
import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { getPlatformIcon } from '@/routes/(main)/agent/channel/const';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors/builtinAgentSelectors';
import { useGlobalStore } from '@/store/global';

// Bump this id when the banner content changes so dismissing the old
// variant does not hide the new one.
export const BOT_INTEGRATION_BANNER_ID = 'bot-integration-v1';

const ICON_SIZE = 16;
const AVATAR_SIZE = 24;

const BANNER_PLATFORM_NAMES = ['Discord', 'Slack', 'Telegram', 'Lark', 'WeChat', 'QQ'] as const;

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
  banner: css`
    cursor: pointer;

    position: absolute;
    z-index: 0;
    inset-block-end: 0;
    inset-inline: 0;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    margin-block-end: -6px;
    padding-block: 42px 10px;
    padding-inline: 16px 12px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: 20px;

    background: color-mix(in srgb, ${cssVar.colorFillQuaternary} 50%, ${cssVar.colorBgContainer});
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

const BotIntegrationBanner = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

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

  const handleNavigateToChannels = useCallback(() => {
    if (!inboxAgentId) return;
    navigate(`/agent/${inboxAgentId}/channel`);
  }, [inboxAgentId, navigate]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const current = useGlobalStore.getState().status.dismissedBannerIds || [];
      if (current.includes(BOT_INTEGRATION_BANNER_ID)) return;
      updateSystemStatus({
        dismissedBannerIds: [...current, BOT_INTEGRATION_BANNER_ID],
      });
    },
    [updateSystemStatus],
  );

  return (
    <div
      className={styles.banner}
      data-testid="bot-integration-banner"
      onClick={handleNavigateToChannels}
    >
      <Flexbox horizontal align="center" gap={4}>
        <Icon className={styles.icon} icon={RadioTowerIcon} size={18} />
        <span className={styles.text}>{t('botIntegrationBanner.title')}</span>
      </Flexbox>
      <Flexbox horizontal align="center" gap={8}>
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
        <ActionIcon
          icon={X}
          size="small"
          title={t('botIntegrationBanner.dismiss')}
          onClick={handleDismiss}
        />
      </Flexbox>
    </div>
  );
});

BotIntegrationBanner.displayName = 'BotIntegrationBanner';

export default BotIntegrationBanner;
