'use client';

import { ActionIcon, ActionIconProps } from '@lobehub/ui';
import { Button, Popover } from 'antd';
import { createStyles } from 'antd-style';
import { Rocket, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useGlobalStore } from '@/store/global';

const PH_LAUNCH_URL = 'https://lobe.li/ph';
const PH_IMAGE_URL = 'https://hub-apac-1.lobeobjects.space/og/lobehub-ph.png';

// Configure the date range for showing the PH launch card
const PH_START_DATE = new Date('2026-01-27T08:00:00Z');
const PH_END_DATE = new Date('2026-02-01T00:00:00Z');

const useStyles = createStyles(({ css, token }) => ({
  action: css`
    margin-block-start: 12px;
  `,
  body: css`
    font-size: 14px;
    color: ${token.colorTextSecondary};
  `,
  card: css`
    position: relative;
    overflow: hidden;
    width: 280px;
    border-radius: 8px;
  `,
  closeButton: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;
  `,
  content: css`
    padding: 12px;
  `,
  image: css`
    overflow: hidden;
    width: 100%;
    height: auto;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
    color: ${token.colorText};
  `,
}));

const ICON_SIZE: ActionIconProps['size'] = {
  blockSize: 36,
  size: 20,
  strokeWidth: 1.5,
};

const PHLaunch = memo(() => {
  const { t } = useTranslation('common');
  const { styles } = useStyles();
  const [open, setOpen] = useState(false);

  const [hidePHLaunch, updateSystemStatus] = useGlobalStore((s) => [
    s.status.hidePHLaunch,
    s.updateSystemStatus,
  ]);

  const isWithinDateRange = useMemo(() => {
    const now = new Date();
    return now >= PH_START_DATE && now <= PH_END_DATE;
  }, []);

  // Auto open the popover if user hasn't seen it yet
  useEffect(() => {
    if (!hidePHLaunch && isWithinDateRange) {
      // Small delay to ensure the component is mounted
      const timer = setTimeout(() => {
        setOpen(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [hidePHLaunch, isWithinDateRange]);

  const handleClose = () => {
    setOpen(false);
    updateSystemStatus({ hidePHLaunch: true });
  };

  const handleAction = () => {
    window.open(PH_LAUNCH_URL, '_blank');
    handleClose();
  };

  // Don't render if outside the date range
  if (!isWithinDateRange) return null;

  const content = (
    <Flexbox className={styles.card}>
      <ActionIcon
        className={styles.closeButton}
        icon={X}
        onClick={handleClose}
        size={{ blockSize: 24, size: 14 }}
      />
      <div className={styles.image}>
        <img
          alt="LobeChat Product Hunt Launch"
          height="100%"
          src={PH_IMAGE_URL}
          style={{ objectFit: 'cover' }}
          width="100%"
        />
      </div>
      <Flexbox className={styles.content} gap={4}>
        <div className={styles.title}>{t('phLaunch.title')}</div>
        <div className={styles.body}>{t('phLaunch.body')}</div>
        <Button block className={styles.action} onClick={handleAction} size="small" type="primary">
          {t('phLaunch.action')}
        </Button>
      </Flexbox>
    </Flexbox>
  );

  return (
    <Popover
      arrow={false}
      content={content}
      onOpenChange={setOpen}
      open={open}
      placement="rightBottom"
      styles={{ body: { padding: 0 } }}
      trigger="click"
    >
      <ActionIcon
        icon={Rocket}
        onClick={() => setOpen(!open)}
        size={ICON_SIZE}
        title="Product Hunt"
        tooltipProps={{ placement: 'right' }}
      />
    </Popover>
  );
});

export default PHLaunch;
