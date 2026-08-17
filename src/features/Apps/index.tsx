'use client';

import { DOWNLOAD_URL, isDesktop } from '@lobechat/const';
import { Icon, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import type { LucideIcon } from 'lucide-react';
import { Check, Copy, MessageCircle, Monitor, Smartphone, Terminal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { styles } from './style';

const CLI_INSTALL_COMMAND = 'npm install -g @lobehub/cli';

const WAYS = [
  {
    ctaKey: 'apps.desktop.cta',
    descKey: 'apps.desktop.desc',
    icon: Monitor,
    id: 'desktop',
    titleKey: 'apps.desktop.title',
  },
  {
    ctaKey: 'apps.mobile.cta',
    descKey: 'apps.mobile.desc',
    icon: Smartphone,
    id: 'mobile',
    titleKey: 'apps.mobile.title',
  },
  {
    ctaKey: 'apps.messenger.cta',
    descKey: 'apps.messenger.desc',
    icon: MessageCircle,
    id: 'messenger',
    titleKey: 'apps.messenger.title',
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

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

const AppsPage = () => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

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
      openExternal(DOWNLOAD_URL.default);
      return;
    }
    if (id === 'mobile') {
      openExternal(DOWNLOAD_URL.mobile);
      return;
    }
    if (id === 'messenger') {
      navigate('/settings/messenger');
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
