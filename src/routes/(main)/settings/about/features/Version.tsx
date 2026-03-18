import { BRANDING_NAME } from '@lobechat/business-const';
import {
  getElectronIpc,
  type UpdaterState,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { Block, Button, Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { CHANGELOG_URL, MANUAL_UPGRADE_URL, OFFICIAL_SITE } from '@/const/url';
import { CURRENT_VERSION } from '@/const/version';
import { useNewVersion } from '@/features/User/UserPanel/useNewVersion';
import { autoUpdateService } from '@/services/electron/autoUpdate';
import { useGlobalStore } from '@/store/global';

import { APP_VERSION } from './appVersion';

const styles = createStaticStyles(({ css, cssVar }) => ({
  logo: css`
    border-radius: calc(${cssVar.borderRadiusLG} * 2);
  `,
}));

const Version = memo<{ mobile?: boolean }>(({ mobile }) => {
  const hasNewVersion = useNewVersion();
  const [latestVersion, serverVersion, useCheckServerVersion] = useGlobalStore((s) => [
    s.latestVersion,
    s.serverVersion,
    s.useCheckServerVersion,
  ]);
  const { t } = useTranslation(['common', 'setting']);

  useCheckServerVersion();

  const showServerVersion = serverVersion && serverVersion !== CURRENT_VERSION;
  const isDesktop = useMemo(() => !!getElectronIpc(), []);

  const [updaterState, setUpdaterState] = useState<UpdaterState>({ stage: 'idle' });
  const [buildChannel, setBuildChannel] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    autoUpdateService.getUpdaterState().then(setUpdaterState);
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop) return;
    autoUpdateService.getBuildChannel().then(setBuildChannel);
  }, [isDesktop]);

  useWatchBroadcast('updaterStateChanged', (state: UpdaterState) => {
    setUpdaterState(state);
  });

  const renderUpdateButton = () => {
    if (!isDesktop) {
      if (hasNewVersion) {
        return (
          <a href={MANUAL_UPGRADE_URL} rel="noreferrer" style={{ flex: 1 }} target="_blank">
            <Button block={mobile} type={'primary'}>
              {t('upgradeVersion.action')}
            </Button>
          </a>
        );
      }
      return null;
    }

    const { stage, progress } = updaterState;

    switch (stage) {
      case 'checking': {
        return (
          <Button loading block={mobile}>
            {t('checkForUpdates')}
          </Button>
        );
      }
      case 'downloading': {
        const percent = progress ? Math.round(progress.percent) : 0;
        return (
          <Button loading block={mobile}>
            {t('downloadingUpdate', { percent })}
          </Button>
        );
      }
      case 'downloaded': {
        return (
          <Button block={mobile} type="primary" onClick={() => void autoUpdateService.installNow()}>
            {t('restartToUpdate')}
          </Button>
        );
      }
      case 'latest': {
        return (
          <Button disabled block={mobile}>
            {t('alreadyUpToDate')}
          </Button>
        );
      }
      default: {
        return (
          <Button block={mobile} onClick={() => void autoUpdateService.checkUpdate()}>
            {t('checkForUpdates')}
          </Button>
        );
      }
    }
  };

  return (
    <Flexbox
      align={mobile ? 'stretch' : 'center'}
      gap={16}
      horizontal={!mobile}
      justify={'space-between'}
      width={'100%'}
    >
      <Flexbox horizontal align={'center'} flex={'none'} gap={16}>
        <a href={OFFICIAL_SITE} rel="noreferrer" target="_blank">
          <Block
            clickable
            align={'center'}
            className={styles.logo}
            height={64}
            justify={'center'}
            width={64}
          >
            <ProductLogo size={52} />
          </Block>
        </a>
        <Flexbox align={'flex-start'} gap={6}>
          <div style={{ fontSize: 18, fontWeight: 'bolder' }}>{BRANDING_NAME}</div>
          <Flexbox gap={6} horizontal={!mobile}>
            <Tag>v{APP_VERSION}</Tag>

            {buildChannel && buildChannel !== 'stable' && (
              <Tag color={'gold'}>
                {t(`setting:tab.advanced.updateChannel.${buildChannel}`, {
                  defaultValue: buildChannel.charAt(0).toUpperCase() + buildChannel.slice(1),
                })}
              </Tag>
            )}
            {showServerVersion && (
              <Tag>{t('upgradeVersion.serverVersion', { version: `v${serverVersion}` })}</Tag>
            )}
            {hasNewVersion && (
              <Tag color={'info'}>
                {t('upgradeVersion.newVersion', { version: `v${latestVersion}` })}
              </Tag>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal flex={mobile ? 1 : undefined} gap={8}>
        <a href={CHANGELOG_URL} rel="noreferrer" style={{ flex: 1 }} target="_blank">
          <Button block={mobile}>{t('changelog')}</Button>
        </a>
        {renderUpdateButton()}
      </Flexbox>
    </Flexbox>
  );
});

export default Version;
