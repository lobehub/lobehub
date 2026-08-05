'use client';

import { type WindowsShellMode } from '@lobechat/electron-client-ipc';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Text } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { desktopSettingsService } from '@/services/electron/settings';
import { getPlatform } from '@/utils/platform';

/**
 * Windows-only: choose the shell that runs agent commands (automatic
 * PowerShell chain vs Git Bash). Other platforms always use /bin/sh, so the
 * whole section is hidden there.
 */
const ShellSection = memo(() => {
  const { t } = useTranslation('setting');
  const [updating, setUpdating] = useState(false);

  const { data, mutate } = useSWR(
    'desktop-shell-settings',
    desktopSettingsService.getShellSettings,
    { revalidateOnFocus: false },
  );

  const handleChange = useCallback(
    async (mode: WindowsShellMode) => {
      setUpdating(true);
      try {
        const next = await desktopSettingsService.setShellMode(mode);
        await mutate(next, { revalidate: false });
      } finally {
        setUpdating(false);
      }
    },
    [mutate],
  );

  const options = [
    { label: t('settingSystemTools.shell.mode.auto'), value: 'auto' as const },
    // Only offer Git Bash when Git for Windows is actually installed.
    ...(data?.gitBashAvailable
      ? [{ label: t('settingSystemTools.shell.mode.gitbash'), value: 'gitbash' as const }]
      : []),
  ];

  const shellGroup: FormGroupItemType = {
    children: [
      {
        children: (
          <Select
            disabled={!data || updating}
            options={options}
            value={data?.mode ?? 'auto'}
            onChange={handleChange}
          />
        ),
        desc: (
          <>
            {t('settingSystemTools.shell.mode.desc')}
            {data && (
              <>
                {' '}
                <Text code fontSize={12} type={'secondary'}>
                  {data.currentShell.path}
                </Text>
              </>
            )}
          </>
        ),
        label: (
          <SettingsSearchAnchor id={'system-tools-shell'}>
            {t('settingSystemTools.shell.mode.title')}
          </SettingsSearchAnchor>
        ),
      },
    ],
    desc: t('settingSystemTools.shell.desc'),
    title: t('settingSystemTools.shell.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[shellGroup]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

const GuardedShellSection = memo(() => {
  if (getPlatform() !== 'Windows') return null;
  return <ShellSection />;
});

export default GuardedShellSection;
