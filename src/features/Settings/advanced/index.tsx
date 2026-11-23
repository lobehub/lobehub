'use client';

import { Spin, Switch } from '@lobehub/ui';
import { Form, type FormFieldProps, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import AdvancedSkeleton from '@/components/Skeleton/Settings/tabs/Advanced';
import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type UserGeneralConfig } from '@/types/user/settings';

import { useDiagnosticsItems } from './useDiagnosticsItems';
import { useRemoteDebuggingItem } from './useRemoteDebuggingItem';

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

  // The update channel lives in About, beside the version and update action.
  const items = (advancedGroup.children as unknown[]).length > 0 ? [advancedGroup] : [];

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
