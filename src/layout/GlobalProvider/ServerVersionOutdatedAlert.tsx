'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MANUAL_UPGRADE_URL } from '@/const/url';
import { CURRENT_VERSION } from '@/const/version';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useGlobalStore } from '@/store/global';

const useStyles = createStyles(({ css, token }) => ({
  closeButton: css`
    cursor: pointer;

    position: absolute;
    inset-block-start: 20px;
    inset-inline-end: 20px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border-radius: ${token.borderRadius}px;

    color: ${token.colorTextSecondary};

    transition: all 0.2s;

    &:hover {
      color: ${token.colorText};
      background: ${token.colorFillSecondary};
    }
  `,
  container: css`
    position: fixed;
    z-index: 9999;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    background: ${token.colorBgMask};
  `,
  content: css`
    position: relative;

    overflow: hidden;

    max-width: 480px;
    padding: 24px;
    border: 1px solid ${token.yellowBorder};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};
    box-shadow: ${token.boxShadowSecondary};
  `,
  desc: css`
    line-height: 1.6;
    color: ${token.colorTextSecondary};
  `,
  title: css`
    font-size: 16px;
    font-weight: bold;
    color: ${token.colorWarningText};
  `,
  titleIcon: css`
    flex-shrink: 0;
    color: ${token.colorWarning};
  `,
  warning: css`
    padding: 12px;
    border-radius: ${token.borderRadius}px;
    color: ${token.colorWarningText};
    background: ${token.yellowBg};
  `,
}));

const ServerVersionOutdatedAlert = () => {
  const { styles } = useStyles();
  const { t } = useTranslation('common');
  const [dismissed, setDismissed] = useState(false);
  const isServerVersionOutdated = useGlobalStore((s) => s.isServerVersionOutdated);
  const storageMode = useElectronStore(electronSyncSelectors.storageMode);

  // Only show alert when using self-hosted server, not cloud
  if (storageMode !== 'selfHost') return null;
  if (!isServerVersionOutdated || dismissed) return null;

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.closeButton} onClick={() => setDismissed(true)}>
          <Icon icon={X} />
        </div>

        <Flexbox gap={16}>
          <Flexbox align="center" gap={8} horizontal>
            <Icon className={styles.titleIcon} icon={TriangleAlert} />
            <div className={styles.title}>{t('serverVersionOutdated.title')}</div>
          </Flexbox>

          <div className={styles.desc}>
            {t('serverVersionOutdated.desc', { version: CURRENT_VERSION })}
          </div>

          <div className={styles.warning}>{t('serverVersionOutdated.warning')}</div>

          <Flexbox gap={8} horizontal justify="flex-end" style={{ marginTop: 8 }}>
            <a href={MANUAL_UPGRADE_URL} rel="noreferrer" target="_blank">
              <Button size="small" type="primary">
                {t('serverVersionOutdated.upgrade')}
              </Button>
            </a>
            <Button onClick={() => setDismissed(true)} size="small">
              {t('serverVersionOutdated.dismiss')}
            </Button>
          </Flexbox>
        </Flexbox>
      </div>
    </div>
  );
};

export default ServerVersionOutdatedAlert;
