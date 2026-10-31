'use client';

import { DOWNLOAD_URL, isDesktop } from '@lobechat/const';
import { Button, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { PlatformAvatar, SUPPORTED_MESSENGER_PLATFORMS } from '@/features/Messenger/constants';
import { sx } from '@/styles/sx';

import { CLI_INSTALL_COMMAND } from './const';
import { CliScene, DesktopScene, MobileScene } from './scenes';
import { styles } from './style';

const openExternal = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

const DESKTOP_FEATURES = ['files', 'tools', 'focus'] as const;

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

  return (
    <div {...stylex.props(styles.page)}>
      <main {...stylex.props(styles.content)}>
        <h1 {...stylex.props(styles.headline)}>{t('apps.title')}</h1>

        <div {...stylex.props(styles.grid)}>
          <article {...stylex.props(styles.card, styles.spanFull)}>
            <div {...stylex.props(styles.heroInner)}>
              <div {...stylex.props(styles.cardBody)}>
                <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                  <h2 {...stylex.props(styles.cardTitle)}>{t('apps.desktop.title')}</h2>
                  {isDesktop && (
                    <Tag icon={<Check size={12} />} size="small">
                      {t('apps.desktop.inUse')}
                    </Tag>
                  )}
                </div>
                <Text style={{ marginTop: 8 }} type="secondary">
                  {t(isDesktop ? 'apps.desktop.inUseDesc' : 'apps.desktop.desc')}
                </Text>
                <ul {...stylex.props(styles.bullets)}>
                  {DESKTOP_FEATURES.map((feature) => (
                    <li key={feature} {...stylex.props(styles.bulletItem)}>
                      <strong {...stylex.props(styles.bulletStrong)}>
                        {t(`apps.desktop.features.${feature}.label`)}
                      </strong>
                      {' — '}
                      {t(`apps.desktop.features.${feature}.desc`)}
                    </li>
                  ))}
                </ul>
                {!isDesktop && (
                  <div {...stylex.props(styles.ctaRow)}>
                    <Button type="primary" onClick={() => openExternal(DOWNLOAD_URL.default)}>
                      {t('apps.desktop.cta')}
                    </Button>
                  </div>
                )}
              </div>
              <DesktopScene />
            </div>
          </article>

          <article {...stylex.props(styles.card)}>
            <div {...stylex.props(styles.cardBody)}>
              <h2 {...stylex.props(styles.cardTitle)}>{t('apps.mobile.title')}</h2>
              <Text style={{ marginTop: 8 }} type="secondary">
                {t('apps.mobile.desc')}
              </Text>
              <div {...stylex.props(styles.ctaRow)}>
                <Button onClick={() => openExternal(DOWNLOAD_URL.mobile)}>
                  {t('apps.mobile.cta')}
                </Button>
              </div>
            </div>
            <MobileScene />
          </article>

          <article {...stylex.props(styles.card)}>
            <div {...sx([styles.cardBody], undefined, { paddingBottom: 20 })}>
              <h2 {...stylex.props(styles.cardTitle)}>{t('apps.messenger.title')}</h2>
              <Text style={{ marginTop: 8 }} type="secondary">
                {t('apps.messenger.desc')}
              </Text>
            </div>
            {SUPPORTED_MESSENGER_PLATFORMS.map((platform) => (
              <div {...stylex.props(styles.channelRow)} key={platform.id}>
                <PlatformAvatar platform={platform.id} size={32} />
                <Text style={{ flex: 1 }} weight={500}>
                  {platform.name}
                </Text>
                <Button
                  icon={ArrowUpRight}
                  iconPosition="end"
                  size="small"
                  onClick={() => navigate('/settings/messenger')}
                >
                  {t('apps.messenger.setup')}
                </Button>
              </div>
            ))}
          </article>

          <article {...stylex.props(styles.card, styles.spanFull)}>
            <div {...stylex.props(styles.cliInner)}>
              <div {...stylex.props(styles.cardBody)}>
                <h2 {...stylex.props(styles.cardTitle)}>{t('apps.cli.title')}</h2>
                <Text style={{ marginTop: 8 }} type="secondary">
                  {t('apps.cli.desc')}
                </Text>
                <div {...stylex.props(styles.command)}>
                  {CLI_INSTALL_COMMAND}
                  <Button icon={copied ? Check : Copy} size="small" onClick={copyInstallCommand}>
                    {copied ? t('apps.cli.copied') : t('apps.cli.copy')}
                  </Button>
                </div>
              </div>
              <CliScene />
            </div>
          </article>
        </div>
      </main>
    </div>
  );
};

export default AppsPage;
