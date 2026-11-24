'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import type { DesktopDownloadUrls } from '@lobechat/types';
import { Block, Button, createStaticStyles,Flexbox, Icon, Text } from '@lobehub/ui';
import { AppleIcon, DownloadIcon, MonitorIcon, TerminalIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DownloadPlatform } from './orderDownloadPlatforms';
import { orderDownloadPlatforms } from './orderDownloadPlatforms';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    max-inline-size: 640px;
    margin-inline: auto;
    padding-block: 48px;
    padding-inline: 24px;
  `,
  row: css`
    padding-block: 16px;
    padding-inline: 20px;
  `,
}));

const PLATFORM_META: Record<DownloadPlatform, { icon: typeof AppleIcon; label: string }> = {
  linux: { icon: TerminalIcon, label: 'Linux (.deb)' },
  macOS: { icon: AppleIcon, label: 'macOS' },
  windows: { icon: MonitorIcon, label: 'Windows' },
};

interface DistributionDownloadsProps {
  urls: DesktopDownloadUrls;
}

/**
 * The download page for a deployment that serves its own installers.
 *
 * Deliberately a plain list rather than a version of the upstream page: that
 * one advertises mobile apps, messenger channels and release channels served
 * from the hosted site, so a self-hosted build showing it offers most of a
 * product it does not ship.
 *
 * Only platforms the deployment has actually configured appear, and the
 * visitor's own comes first — see `orderDownloadPlatforms`.
 */
const DistributionDownloads = memo<DistributionDownloadsProps>(({ urls }) => {
  const { t } = useTranslation('common');

  const platforms = useMemo(
    () => orderDownloadPlatforms(urls, typeof navigator === 'undefined' ? '' : navigator.userAgent),
    [urls],
  );

  return (
    <Flexbox className={styles.page} gap={24}>
      <Text as={'h1'} fontSize={24} weight={600}>
        {t('getApp', { defaultValue: `Download ${BRANDING_NAME}` })}
      </Text>

      <Flexbox gap={12}>
        {platforms.map((platform) => (
          <Block className={styles.row} key={platform} variant={'outlined'}>
            <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
              <Flexbox horizontal align={'center'} gap={12}>
                <Icon icon={PLATFORM_META[platform].icon} size={22} />
                <Text weight={500}>{PLATFORM_META[platform].label}</Text>
              </Flexbox>
              {/* A plain link rather than fetch-then-save: the file comes from
                  our own origin, and the browser's own download UI is the one
                  the user can pause, resume and find again afterwards. */}
              <a download href={urls[platform]} rel={'noreferrer'}>
                <Button icon={<Icon icon={DownloadIcon} size={14} />} type={'primary'}>
                  {t('download', { defaultValue: 'Download' })}
                </Button>
              </a>
            </Flexbox>
          </Block>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default DistributionDownloads;
