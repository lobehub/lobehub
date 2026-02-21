'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, HotkeyInput, Icon, Skeleton } from '@lobehub/ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import { FORM_STYLE } from '@/const/layoutTokens';
import hotkeyMeta from '@/locales/default/hotkey';
import { useElectronStore } from '@/store/electron';
import { desktopHotkeysSelectors } from '@/store/electron/selectors';
import { type DesktopHotkeyItem } from '@/types/hotkey';

const HotkeySetting = memo(() => {
  const { t } = useTranslation(['setting', 'hotkey']);
  const [form] = Form.useForm();
  const { message } = App.useApp();

  const hotkeys = useElectronStore(desktopHotkeysSelectors.hotkeys, isEqual);

  const [isHotkeysInit, updateDesktopHotkey, useFetchDesktopHotkeys] = useElectronStore((s) => [
    desktopHotkeysSelectors.isHotkeysInit(s),
    s.updateDesktopHotkey,
    s.useFetchDesktopHotkeys,
  ]);

  useFetchDesktopHotkeys();

  const [loading, setLoading] = useState(false);

  if (!isHotkeysInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const mapHotkeyItem = (item: DesktopHotkeyItem) => ({
    children: (
      <HotkeyInput
        disabled={item.nonEditable}
        placeholder={t('hotkey.record')}
        resetValue={item.keys}
        value={hotkeys[item.id]}
        onChange={async (value) => {
          setLoading(true);
          try {
            const result = await updateDesktopHotkey(item.id, value);
            if (result.success) {
              message.success(t('hotkey.updateSuccess', { ns: 'setting' }));
            } else {
              // 根据错误类型显示相应的错误消息

              message.error(t(`hotkey.errors.${result.errorType}` as any, { ns: 'setting' }));
            }
          } catch {
            message.error(t('hotkey.updateError', { ns: 'setting' }));
          } finally {
            setLoading(false);
          }
        }}
      />
    ),

    desc: hotkeyMeta[`desktop.${item.id}.desc` as keyof typeof hotkeyMeta]
      ? t(`desktop.${item.id}.desc` as keyof typeof hotkeyMeta, { ns: 'hotkey' })
      : undefined,
    label: t(`desktop.${item.id}.title` as keyof typeof hotkeyMeta, { ns: 'hotkey' }),
    name: item.id,
  });

  const desktop: FormGroupItemType = {
    children: DESKTOP_HOTKEYS_REGISTRATION.map((item) => mapHotkeyItem(item)),
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('hotkey.group.desktop'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={hotkeys}
      items={[desktop]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default HotkeySetting;
