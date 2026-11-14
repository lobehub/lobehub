'use client';

import { isDesktop } from '@lobechat/const';
import { Select, Spin, Switch } from '@lobehub/ui';
import { Form, type FormFieldProps, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import AdvancedSkeleton from '@/components/Skeleton/Settings/tabs/Advanced';
import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { autoUpdateService } from '@/services/electron/autoUpdate';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type UserGeneralConfig } from '@/types/user/settings';

import { useDiagnosticsItems } from './useDiagnosticsItems';
import { useRemoteDebuggingItem } from './useRemoteDebuggingItem';

type UpdateChannelValue = 'canary' | 'stable';

const Page = memo<{ showSettingHeader?: boolean }>(({ showSettingHeader = true }) => {
  const { t } = useTranslation('setting');

  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const defaultAgentGatewayModeEnabled = useUserStore(
    (s) => settingsSelectors.defaultAgentConfig(s).chatConfig?.disableGatewayMode !== true,
  );
  const [setSettings, updateDefaultAgent, isUserStateInit, isUserStateInitError, refreshUserState] =
    useUserStore((s) => [
      s.setSettings,
      s.updateDefaultAgent,
      s.isUserStateInit,
      s.isUserStateInitError,
      s.refreshUserState,
    ]);
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

  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);
  const diagnosticsItems = useDiagnosticsItems<UserGeneralConfig>();
  const remoteDebuggingItem = useRemoteDebuggingItem<UserGeneralConfig>();

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

  const handleGatewayModeChange = useCallback(
    (checked: boolean) => {
      updateDefaultAgent({
        config: { chatConfig: { disableGatewayMode: checked ? false : true } },
      });
    },
    [updateDefaultAgent],
  );

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
    // The registered tab skeleton, so the chunk and data waits show one shape.
    return (
      <>
        {showSettingHeader && <SettingHeader title={t('tab.advanced')} />}
        <AdvancedSkeleton.Body />
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
      ...(enableGatewayMode
        ? [
            {
              children: (
                <Switch
                  checked={defaultAgentGatewayModeEnabled}
                  onChange={handleGatewayModeChange}
                />
              ),
              desc: t('tab.advanced.gatewayMode.desc'),
              label: (
                <SettingsSearchAnchor id={'advanced-gateway-mode'}>
                  {t('tab.advanced.gatewayMode.title')}
                </SettingsSearchAnchor>
              ),
              minWidth: undefined,
            } satisfies FormFieldProps<UserGeneralConfig>,
          ]
        : []),
      ...diagnosticsItems,
      ...(remoteDebuggingItem ? [remoteDebuggingItem] : []),
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
      {showSettingHeader && <SettingHeader title={t('tab.advanced')} />}
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
