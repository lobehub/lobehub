'use client';

import { isDesktop } from '@lobechat/const';
import { Select, Spin, Switch } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { SettingsSectionSkeleton } from '@/components/Skeleton';
import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { autoUpdateService } from '@/services/electron/autoUpdate';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type UserGeneralConfig } from '@/types/user/settings';

type UpdateChannelValue = 'canary' | 'stable';

const Page = memo(() => {
  const { t } = useTranslation('setting');

  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const [setSettings, isUserStateInit, isUserStateInitError, refreshUserState] = useUserStore(
    (s) => [s.setSettings, s.isUserStateInit, s.isUserStateInitError, s.refreshUserState],
  );
  const [loading, setLoading] = useState(false);
  const form = useForm({
    initialValues: general,
    values: general,
    onValuesChange: async (v) => {
      setLoading(true);
      await setSettings({ general: v });
      setLoading(false);
    },
  });

  const [channel, setChannel] = useState<UpdateChannelValue>('stable');

  useEffect(() => {
    if (!isDesktop) return;
    autoUpdateService
      .getUpdateChannel()
      .then(setChannel)
      .catch(() => {});
  }, []);

  const handleChannelChange = useCallback((value: UpdateChannelValue) => {
    setChannel(value);
    autoUpdateService.setUpdateChannel(value);
  }, []);

  if (!isUserStateInit) {
    // A failed user-state init must show error + Retry, not a permanent skeleton
    //
    if (isUserStateInitError)
      return (
        <AsyncError
          error={isUserStateInitError}
          variant={'block'}
          onRetry={() => refreshUserState()}
        />
      );
    // Mirror the loaded page: header plus the single-row tools group (dev mode)
    // and, on desktop, the single-row update-channel group.
    return (
      <>
        <SettingHeader title={t('tab.advanced')} />
        <SettingsSectionSkeleton
          groups={[
            { rows: 1, titleWidth: 160 },
            ...(isDesktop ? [{ rows: 1, titleWidth: 112 }] : []),
          ]}
        />
      </>
    );
  }

  const advancedGroup: FormGroupItem<UserGeneralConfig> = {
    children: [
      {
        children: <Switch />,
        desc: t('settingCommon.devMode.desc'),
        label: (
          <SettingsSearchAnchor id={'advanced-dev-mode'}>
            {t('settingCommon.devMode.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
        name: 'isDevMode',
      },
    ],
    extra: loading && <Spin size="small" style={{ opacity: 0.5 }} />,
    title: t('tab.advanced.toolsAndDiagnostics.title'),
  };

  const channelOptions = [
    { label: t('tab.advanced.updateChannel.stable'), value: 'stable' as const },
    { label: t('tab.advanced.updateChannel.canary'), value: 'canary' as const },
  ];

  const updateChannelGroup: FormGroupItem<UserGeneralConfig> = {
    children: [
      {
        children: (
          <Select options={channelOptions} value={channel} onChange={handleChannelChange} />
        ),
        desc: t('tab.advanced.updateChannel.desc'),
        label: (
          <SettingsSearchAnchor id={'advanced-update-channel'}>
            {t('tab.advanced.updateChannel.title')}
          </SettingsSearchAnchor>
        ),
      },
    ],
    title: t('tab.advanced.appUpdates.title'),
  };

  const items = isDesktop ? [advancedGroup, updateChannelGroup] : [advancedGroup];

  return (
    <>
      <SettingHeader title={t('tab.advanced')} />
      <Form
        collapsible={false}
        form={form}
        items={items}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
    </>
  );
});

export default Page;
