'use client';

import { ActionIcon } from '@lobehub/ui';
import { Discord, Slack, Telegram } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { X } from 'lucide-react';
import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

// Bump this id when the card content changes so dismissing the old
// variant does not hide the new one.
const MESSENGER_PROMO_ID = 'messenger-promo-v1';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    position: relative;

    display: flex;
    flex-direction: column;
    gap: 8px;

    margin-block: 0 8px;
    margin-inline: 12px;
    padding: 12px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: 12px;

    background: color-mix(in srgb, ${cssVar.colorFillQuaternary} 50%, ${cssVar.colorBgContainer});

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  closeButton: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 4px;
    inset-inline-end: 4px;
  `,
  desc: css`
    font-size: 11px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  iconRow: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

const ICON_SIZE = 16;

const MessengerPromo = memo(() => {
  const { t } = useTranslation('agent');
  const navigate = useNavigate();

  const isDismissed = useGlobalStore(systemStatusSelectors.isBannerDismissed(MESSENGER_PROMO_ID));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const handleClick = useCallback(() => {
    navigate('/settings/messenger');
  }, [navigate]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const current = useGlobalStore.getState().status.dismissedBannerIds || [];
      if (current.includes(MESSENGER_PROMO_ID)) return;
      updateSystemStatus({
        dismissedBannerIds: [...current, MESSENGER_PROMO_ID],
      });
    },
    [updateSystemStatus],
  );

  if (isDismissed) return null;

  return (
    <div className={styles.card} onClick={handleClick}>
      <div className={styles.closeButton}>
        <ActionIcon
          icon={X}
          size="small"
          title={t('channel.messengerPromo.dismiss')}
          onClick={handleDismiss}
        />
      </div>
      <div className={styles.iconRow}>
        <Slack.Color size={ICON_SIZE} />
        <Discord.Color size={ICON_SIZE} />
        <Telegram.Color size={ICON_SIZE} />
      </div>
      <div className={styles.title}>{t('channel.messengerPromo.title')}</div>
      <div className={styles.desc}>{t('channel.messengerPromo.desc')}</div>
    </div>
  );
});

MessengerPromo.displayName = 'MessengerPromo';

export default MessengerPromo;
