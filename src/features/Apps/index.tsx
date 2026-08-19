'use client';

import { CLI_INSTALL_COMMAND } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { Icon, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import type { LucideIcon } from 'lucide-react';
import { Check, Copy, Monitor, Terminal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDesktopDownload } from '@/features/Downloads/useDesktopDownload';

import { styles } from './style';

const ALL_WAYS = [
  {
    ctaKey: 'apps.desktop.cta',
    descKey: 'apps.desktop.desc',
    icon: Monitor,
    id: 'desktop',
    titleKey: 'apps.desktop.title',
  },
  {
    ctaKey: 'apps.cli.copy',
    descKey: 'apps.cli.desc',
    icon: Terminal,
    id: 'cli',
    titleKey: 'apps.cli.title',
  },
] as const satisfies ReadonlyArray<{
  ctaKey: string;
  descKey: string;
  icon: LucideIcon;
  id: string;
  titleKey: string;
}>;

const AppsPage = () => {
  const { t } = useTranslation('setting');
  const [copied, setCopied] = useState(false);
  const desktopDownload = useDesktopDownload();

  // Mobile and Messenger are upstream capabilities this deployment does not
  // have (no APK/TestFlight build, no bot integrations) — dropped rather than
  // left pointing at a dead end. Desktop only shows once there is somewhere
  // real for it to lead, same rule as everywhere else that offers it (see
  // useDesktopDownload's doc comment).
  const WAYS = ALL_WAYS.filter((way) => way.id !== 'desktop' || desktopDownload.available);

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

  const onAct = (id: (typeof WAYS)[number]['id']) => {
    if (id === 'desktop') {
      if (desktopDownload.href) window.open(desktopDownload.href, '_blank', 'noopener,noreferrer');
      return;
    }
    void copyInstallCommand();
  };

  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <div className={styles.grid}>
          <header className={styles.header}>
            <div className={styles.headerTop}>
              <span className={styles.index}>00</span>
              <span className={styles.kicker}>{t('apps.kicker')}</span>
            </div>
            <h1 className={styles.pageTitle}>{t('apps.title')}</h1>
          </header>

          {WAYS.map((way, index) => {
            const inUse = way.id === 'desktop' && isDesktop;

            return (
              <article className={styles.cell} key={way.id}>
                <div className={styles.cellMeta}>
                  <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.iconBox}>
                    <Icon icon={way.icon} size={18} />
                  </span>
                </div>
                <div className={styles.cellBody}>
                  <h2 className={styles.cellTitle}>{t(way.titleKey)}</h2>
                  <Text type="secondary">{t(inUse ? 'apps.desktop.inUseDesc' : way.descKey)}</Text>
                </div>
                <div className={styles.actionSlot}>
                  {way.id === 'cli' && (
                    <code className={styles.command}>{CLI_INSTALL_COMMAND}</code>
                  )}
                  {inUse ? (
                    <Tag icon={<Check size={12} />} size="small">
                      {t('apps.desktop.inUse')}
                    </Tag>
                  ) : (
                    <Button
                      icon={way.id === 'cli' ? (copied ? Check : Copy) : undefined}
                      onClick={() => onAct(way.id)}
                    >
                      {way.id === 'cli' && copied ? t('apps.cli.copied') : t(way.ctaKey)}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default AppsPage;
