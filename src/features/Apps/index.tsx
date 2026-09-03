'use client';

import { APP_SHOWCASE_ENABLED, CLI_INSTALL_COMMAND } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDesktopDownload } from '@/features/Downloads/useDesktopDownload';

import { CliScene, DesktopScene } from './scenes';
import { styles } from './style';

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

const DESKTOP_FEATURES = ['files', 'tools', 'focus'] as const;

const AppsPage = () => {
  const { t } = useTranslation('setting');
  const [copied, setCopied] = useState(false);
  const desktopDownload = useDesktopDownload();

  // Mobile and Messenger are upstream capabilities this deployment does not
  // have (no APK/TestFlight build, no bot integrations) — dropped rather than
  // left pointing at a dead end. Desktop only shows once there is somewhere
  // real for it to lead, same rule as everywhere else that offers it (see
  // useDesktopDownload's doc comment).
  const showDesktop = desktopDownload.available;

  const copyInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(CLI_INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error(error);
      setCopied(false);
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <h1 className={styles.headline}>{t('apps.title')}</h1>

        <div className={styles.grid}>
          {showDesktop && (
            <article className={`${styles.card} ${styles.spanFull}`}>
              <div className={styles.heroInner}>
                <div className={styles.cardBody}>
                  <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                    <h2 className={styles.cardTitle}>{t('apps.desktop.title')}</h2>
                    {isDesktop && (
                      <Tag icon={<Check size={12} />} size="small">
                        {t('apps.desktop.inUse')}
                      </Tag>
                    )}
                  </div>
                  <Text style={{ marginTop: 8 }} type="secondary">
                    {t(isDesktop ? 'apps.desktop.inUseDesc' : 'apps.desktop.desc')}
                  </Text>
                  <ul className={styles.bullets}>
                    {DESKTOP_FEATURES.map((feature) => (
                      <li key={feature}>
                        <strong>{t(`apps.desktop.features.${feature}.label`)}</strong>
                        {' — '}
                        {t(`apps.desktop.features.${feature}.desc`)}
                      </li>
                    ))}
                  </ul>
                  {!isDesktop && (
                    <div className={styles.ctaRow}>
                      <Button
                        type="primary"
                        onClick={() => desktopDownload.href && openExternal(desktopDownload.href)}
                      >
                        {t('apps.desktop.cta')}
                      </Button>
                    </div>
                  )}
                </div>
                {APP_SHOWCASE_ENABLED && <DesktopScene />}
              </div>
            </article>
          )}

          <article className={`${styles.card} ${styles.spanFull}`}>
            <div className={styles.cliInner}>
              <div className={styles.cardBody}>
                <h2 className={styles.cardTitle}>{t('apps.cli.title')}</h2>
                <Text style={{ marginTop: 8 }} type="secondary">
                  {t('apps.cli.desc')}
                </Text>
                <div className={styles.command}>
                  {CLI_INSTALL_COMMAND}
                  <Button icon={copied ? Check : Copy} size="small" onClick={copyInstallCommand}>
                    {copied ? t('apps.cli.copied') : t('apps.cli.copy')}
                  </Button>
                </div>
              </div>
              {APP_SHOWCASE_ENABLED && <CliScene />}
            </div>
          </article>
        </div>
      </main>
    </div>
  );
};

export default AppsPage;
