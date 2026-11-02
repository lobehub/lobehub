'use client';

import { HotkeyInput } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { SettingsSectionSkeleton } from '@/components/Skeleton';
import { FORM_STYLE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { electronKeys } from '@/libs/swr/keys';
import { electronSystemService } from '@/services/electron/system';

import { collectAppMenuHotkeys } from './appMenuHotkeys';

/**
 * Read-only list of the desktop app menu accelerators (New Agent, New Topic, Zoom, …).
 * Reads the live Electron menu, so labels are localized and keys match the current platform.
 */
const AppMenuHotkeys = memo(() => {
  const { t } = useTranslation('setting');
  const form = useForm();
  const { data, isLoading } = useSWR(
    // Desktop-only IPC: never fetch off-desktop.
    isDesktop ? electronKeys.appMenu() : null,
    () => electronSystemService.getAppMenu(),
    {
      // The section simply stays hidden; the menu itself still works.
      onError: (error: unknown) => console.error('Failed to load the app menu hotkeys:', error),
      revalidateOnFocus: false,
    },
  );

  const hotkeys = useMemo(() => collectAppMenuHotkeys(data ?? []), [data]);

  if (isLoading)
    return (
      <SettingsSectionSkeleton
        groups={[
          {
            // Hotkey recorder inputs settle at 335x36.
            control: { height: 36, width: 335 },
            rows: 8,
            titleWidth: 96,
            withDesc: false,
          },
        ]}
      />
    );

  if (hotkeys.length === 0) return null;

  const appMenu: FormGroupItem = {
    children: hotkeys.map((item) => ({
      children: (
        <HotkeyInput disabled allowReset={false} resetValue={item.keys} value={item.keys} />
      ),
      label: item.label,
      tag: item.menu,
    })),
    desc: t('hotkey.group.appMenuDesc'),
    title: (
      <SettingsSearchAnchor id={'hotkey-app-menu'}>
        {t('hotkey.group.appMenu')}
      </SettingsSearchAnchor>
    ),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[appMenu]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

AppMenuHotkeys.displayName = 'AppMenuHotkeys';

export default AppMenuHotkeys;
