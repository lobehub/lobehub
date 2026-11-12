'use client';

import { isDesktop } from '@lobechat/const';
import { confirmModal, Switch } from '@lobehub/ui';
import { type FormFieldProps } from '@lobehub/ui/form';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { desktopSettingsService } from '@/services/electron/settings';

/**
 * Desktop-only Diagnostics row: persist the Chromium DevTools protocol (CDP) port for
 * every launch, so agents can drive a packaged build. Chromium reads the switch only at
 * startup, so the row says when a change still needs a restart. A launch option that
 * already opened CDP shows the switch on and locked.
 */
export const useRemoteDebuggingItem = (): FormFieldProps | undefined => {
  const { t } = useTranslation('setting');
  const [updating, setUpdating] = useState(false);

  const { data, mutate } = useSWR(
    isDesktop ? 'desktop-remote-debugging-settings' : null,
    desktopSettingsService.getRemoteDebuggingSettings,
    { revalidateOnFocus: false },
  );

  if (!isDesktop) return;

  const save = async (enabled: boolean) => {
    setUpdating(true);
    try {
      const next = await desktopSettingsService.setRemoteDebuggingEnabled(enabled);
      await mutate(next, { revalidate: false });
    } finally {
      setUpdating(false);
    }
  };

  const port = data?.port;
  const desc = data?.openedByLaunchOption
    ? t('settingAbout.remoteDebugging.launchOptionDesc')
    : data && data.enabled !== data.active
      ? t('settingAbout.remoteDebugging.restartToApply')
      : t('settingAbout.remoteDebugging.desc', { port });

  return {
    children: (
      <Switch
        checked={data ? data.openedByLaunchOption || data.enabled : false}
        disabled={!data || data.openedByLaunchOption}
        loading={updating}
        onChange={(checked: boolean) => {
          if (!checked) {
            void save(false);
            return;
          }
          // Opening CDP hands local programs full control of the app; confirm first.
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: t('settingAbout.remoteDebugging.confirm.content', { port }),
            okButtonProps: { danger: true },
            okText: t('settingAbout.remoteDebugging.confirm.ok'),
            onOk: () => save(true),
            title: t('settingAbout.remoteDebugging.confirm.title'),
          });
        }}
      />
    ),
    desc,
    label: (
      <SettingsSearchAnchor id={'about-remote-debugging'}>
        {t('settingAbout.remoteDebugging.title')}
      </SettingsSearchAnchor>
    ),
    minWidth: undefined,
  };
};
