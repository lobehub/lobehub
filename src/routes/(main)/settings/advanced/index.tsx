'use client';

import { isDesktop } from '@lobechat/const';
import { type FormGroupItemType, type FormItemProps } from '@lobehub/ui';
import { Form, Icon, Skeleton } from '@lobehub/ui';
import { Select, Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { autoUpdateService } from '@/services/electron/autoUpdate';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

type UpdateChannelValue = 'canary' | 'stable';

const styles = createStaticStyles(({ css }) => ({
  labItem: css`
    .ant-form-item-row {
      align-items: center !important;
    }
  `,
}));

const Page = memo(() => {
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

  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);

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
    return <Skeleton active paragraph={{ rows: 5 }} title={false} />;
  }

  const advancedGroup: FormGroupItemType = {
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
        valuePropName: 'checked',
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
              className: styles.labItem,
              desc: t('tab.advanced.gatewayMode.desc'),
              label: (
                <SettingsSearchAnchor id={'advanced-gateway-mode'}>
                  {t('tab.advanced.gatewayMode.title')}
                </SettingsSearchAnchor>
              ),
              minWidth: undefined,
            } satisfies FormItemProps,
          ]
        : []),
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('tab.advanced.toolsAndDiagnostics.title'),
  };

  const channelOptions = [
    { label: t('tab.advanced.updateChannel.stable'), value: 'stable' as const },
    { label: t('tab.advanced.updateChannel.canary'), value: 'canary' as const },
  ];

  const updateChannelGroup: FormGroupItemType = {
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
        initialValues={general}
        items={items}
        itemsType={'group'}
        variant={'filled'}
        onValuesChange={async (v) => {
          setLoading(true);
          await setSettings({ general: v });
          setLoading(false);
        }}
        {...FORM_STYLE}
      />
    </>
  );
});

export default Page;
