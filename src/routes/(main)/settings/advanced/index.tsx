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

import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { autoUpdateService } from '@/services/electron/autoUpdate';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
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
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [loading, setLoading] = useState(false);

  const [
    isPreferenceInit,
    enableAgentSelfIteration,
    enableInputMarkdown,
    enableGatewayMode,
    updateLab,
  ] = useUserStore((s) => [
    preferenceSelectors.isPreferenceInit(s),
    labPreferSelectors.enableAgentSelfIteration(s),
    labPreferSelectors.enableInputMarkdown(s),
    labPreferSelectors.enableGatewayMode(s),
    s.updateLab,
  ]);

  const { enableAgentSelfIteration: canShowAgentSelfIterationLab } =
    useServerConfigStore(featureFlagsSelectors);
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

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

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
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('tab.advanced'),
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
    title: t('tab.advanced.updateChannel.title'),
  };

  const labItems: FormItemProps[] = [
    ...(canShowAgentSelfIterationLab
      ? [
          {
            children: (
              <Switch
                checked={enableAgentSelfIteration}
                loading={!isPreferenceInit}
                onChange={(checked: boolean) => updateLab({ enableAgentSelfIteration: checked })}
              />
            ),
            className: styles.labItem,
            desc: tLabs('features.agentSelfIteration.desc'),
            label: tLabs('features.agentSelfIteration.title'),
            minWidth: undefined,
          } satisfies FormItemProps,
        ]
      : []),
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
    ...(hasGatewayUrl
      ? [
          {
            children: (
              <Switch
                checked={enableGatewayMode}
                loading={!isPreferenceInit}
                onChange={(checked: boolean) => updateLab({ enableGatewayMode: checked })}
              />
            ),
            className: styles.labItem,
            desc: tLabs('features.gatewayMode.desc'),
            label: tLabs('features.gatewayMode.title'),
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
