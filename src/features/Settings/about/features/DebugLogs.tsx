'use client';

import { isDesktop } from '@lobechat/const';
import { Button, Switch } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { FolderOpen } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { desktopSettingsService } from '@/services/electron/settings';

import { useRemoteDebuggingItem } from './useRemoteDebuggingItem';

/**
 * Desktop-only: packaged builds record `info` and above by default; this switch
 * adds `debug` records while a user reproduces a bug. Dev builds always record
 * `debug`, so the switch shows on and locked there.
 */
const DebugLogs = memo(() => {
  const { t } = useTranslation('setting');
  const [updating, setUpdating] = useState(false);
  const form = useForm();
  const remoteDebuggingItem = useRemoteDebuggingItem();

  const { data, mutate } = useSWR(
    isDesktop ? 'desktop-debug-logging-settings' : null,
    desktopSettingsService.getDebugLoggingSettings,
    { revalidateOnFocus: false },
  );

  if (!isDesktop) return null;

  const items: FormGroupItem = {
    children: [
      {
        children: (
          <Switch
            checked={data ? data.alwaysOn || data.enabled : false}
            disabled={!data || data.alwaysOn}
            loading={updating}
            onChange={async (checked: boolean) => {
              setUpdating(true);
              try {
                const next = await desktopSettingsService.setDebugLoggingEnabled(checked);
                await mutate(next, { revalidate: false });
              } finally {
                setUpdating(false);
              }
            }}
          />
        ),
        desc: data?.alwaysOn
          ? t('settingAbout.debugLogs.devDesc')
          : t('settingAbout.debugLogs.desc'),
        label: (
          <SettingsSearchAnchor id={'about-debug-logs'}>
            {t('settingAbout.debugLogs.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      {
        children: (
          <Button icon={FolderOpen} onClick={() => desktopSettingsService.openLogDirectory()}>
            {t('settingAbout.debugLogs.openDirectory')}
          </Button>
        ),
        desc: t('settingAbout.debugLogs.openDirectoryDesc'),
        label: t('settingAbout.debugLogs.directory'),
        minWidth: undefined,
      },
      ...(remoteDebuggingItem ? [remoteDebuggingItem] : []),
    ],
    title: t('settingAbout.diagnostics.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[items]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default DebugLogs;
