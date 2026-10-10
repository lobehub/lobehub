'use client';

import { HotkeyInput, Skeleton, Spin, toast } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HOTKEYS_REGISTRATION } from '@/const/desktopGlobalShortcuts';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useElectronStore } from '@/store/electron';
import { desktopHotkeysSelectors } from '@/store/electron/selectors';
import { type DesktopHotkeyConfig, type DesktopHotkeyItem } from '@/types/hotkey';

const HotkeySetting = memo(() => {
  const { t } = useTranslation(['setting', 'hotkey']);
  const hotkeys = useElectronStore(desktopHotkeysSelectors.hotkeys, isEqual);
  const form = useForm({ initialValues: hotkeys, values: hotkeys });

  const [isHotkeysInit, updateDesktopHotkey, useFetchDesktopHotkeys] = useElectronStore((s) => [
    desktopHotkeysSelectors.isHotkeysInit(s),
    s.updateDesktopHotkey,
    s.useFetchDesktopHotkeys,
  ]);

  useFetchDesktopHotkeys();

  const [loading, setLoading] = useState(false);

  if (!isHotkeysInit) return <Skeleton.Text rows={5} />;

  const updateHotkey = async (id: DesktopHotkeyItem['id'], value: string) => {
    setLoading(true);
    try {
      const result = await updateDesktopHotkey(id, value);
      if (result.success) {
        toast.success(t('hotkey.updateSuccess', { ns: 'setting' }));
      } else {
        // Show the appropriate error message based on error type
        toast.error(t(`hotkey.errors.${result.errorType}` as any, { ns: 'setting' }));
      }
    } catch {
      toast.error(t('hotkey.updateError', { ns: 'setting' }));
    } finally {
      setLoading(false);
    }
  };

  const mapHotkeyItem = (item: DesktopHotkeyItem) => ({
    children: (
      <HotkeyInput
        allowClear={!item.nonEditable}
        disabled={item.nonEditable}
        placeholder={t('hotkey.record')}
        resetValue={item.keys}
        texts={{ clear: t('hotkey.clearBinding') }}
        value={hotkeys[item.id]}
        onChange={(value) => void updateHotkey(item.id, value)}
      />
    ),

    label: t(`desktop.${item.id}.title`, { ns: 'hotkey' }),
    name: item.id,
  });

  const desktop: FormGroupItem<DesktopHotkeyConfig> = {
    children: DESKTOP_HOTKEYS_REGISTRATION.map((item) => mapHotkeyItem(item)),
    extra: loading && <Spin size="small" style={{ opacity: 0.5 }} />,
    title: (
      <SettingsSearchAnchor id={'hotkey-desktop'}>{t('hotkey.group.desktop')}</SettingsSearchAnchor>
    ),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[desktop]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default HotkeySetting;
