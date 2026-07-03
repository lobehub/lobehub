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
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { autoUpdateService } from '@/services/electron/autoUpdate';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors, settingsSelectors } from '@/store/user/selectors';

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
  const { t: tLabs } = useTranslation('labs');

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

  const [
    isPreferenceInit,
    enableAgentDocumentFloatingChatPanel,
    enableInputMarkdown,
    enablePlatformAgent,
    enableImessage,
    enableFleet,
    enableTaskVerify,
    enableFoldFinishedTurn,
    updateLab,
  ] = useUserStore((s) => [
    preferenceSelectors.isPreferenceInit(s),
    labPreferSelectors.enableAgentDocumentFloatingChatPanel(s),
    labPreferSelectors.enableInputMarkdown(s),
    labPreferSelectors.enablePlatformAgent(s),
    labPreferSelectors.enableImessage(s),
    labPreferSelectors.enableFleet(s),
    labPreferSelectors.enableTaskVerify(s),
    labPreferSelectors.enableFoldFinishedTurn(s),
    s.updateLab,
  ]);

  const enableGatewayMode = useServerConfigStore(serverConfigSelectors.enableGatewayMode);
  const hasGatewayUrl = useServerConfigStore((s) => !!s.serverConfig.agentGatewayUrl);

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
    // (LOBE-11139).
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
        label: t('settingCommon.devMode.title'),
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
              label: t('tab.advanced.gatewayMode.title'),
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
        label: t('tab.advanced.updateChannel.title'),
      },
    ],
    title: t('tab.advanced.appUpdates.title'),
  };

  const labItems: FormItemProps[] = [
    {
      children: (
        <Switch
          checked={enableAgentDocumentFloatingChatPanel}
          loading={!isPreferenceInit}
          onChange={(checked) => updateLab({ enableAgentDocumentFloatingChatPanel: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.agentDocumentFloatingChatPanel.desc'),
      label: tLabs('features.agentDocumentFloatingChatPanel.title'),
      minWidth: undefined,
    },
    {
      children: (
        <Switch
          checked={enableInputMarkdown}
          loading={!isPreferenceInit}
          onChange={(checked) => updateLab({ enableInputMarkdown: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.inputMarkdown.desc'),
      label: tLabs('features.inputMarkdown.title'),
      minWidth: undefined,
    },
    {
      children: (
        <Switch
          checked={enableTaskVerify}
          loading={!isPreferenceInit}
          onChange={(checked) => updateLab({ enableTaskVerify: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.taskVerify.desc'),
      label: tLabs('features.taskVerify.title'),
      minWidth: undefined,
    },
    {
      children: (
        <Switch
          checked={enableFoldFinishedTurn}
          loading={!isPreferenceInit}
          onChange={(checked) => updateLab({ enableFoldFinishedTurn: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.foldFinishedTurn.desc'),
      label: tLabs('features.foldFinishedTurn.title'),
      minWidth: undefined,
    },
    ...(isDesktop
      ? [
          {
            children: (
              <Switch
                checked={enableImessage}
                loading={!isPreferenceInit}
                onChange={(checked: boolean) => updateLab({ enableImessage: checked })}
              />
            ),
            className: styles.labItem,
            desc: tLabs('features.imessage.desc'),
            label: tLabs('features.imessage.title'),
            minWidth: undefined,
          } satisfies FormItemProps,
          {
            children: (
              <Switch
                checked={enableFleet}
                loading={!isPreferenceInit}
                onChange={(checked: boolean) => updateLab({ enableFleet: checked })}
              />
            ),
            className: styles.labItem,
            desc: tLabs('features.fleet.desc'),
            label: tLabs('features.fleet.title'),
            minWidth: undefined,
          } satisfies FormItemProps,
        ]
      : []),
    ...(hasGatewayUrl
      ? [
          {
            children: (
              <Switch
                checked={enablePlatformAgent}
                loading={!isPreferenceInit}
                onChange={(checked: boolean) => updateLab({ enablePlatformAgent: checked })}
              />
            ),
            className: styles.labItem,
            desc: tLabs('features.platformAgent.desc'),
            label: tLabs('features.platformAgent.title'),
            minWidth: undefined,
          } satisfies FormItemProps,
        ]
      : []),
  ];

  const labsGroup: FormGroupItemType = {
    children: labItems,
    title: tLabs('title'),
  };

  const items = isDesktop
    ? [advancedGroup, updateChannelGroup, labsGroup]
    : [advancedGroup, labsGroup];

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
