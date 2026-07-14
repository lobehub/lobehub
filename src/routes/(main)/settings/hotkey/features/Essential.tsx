'use client';

import { HotkeyGroupEnum } from '@lobechat/const/hotkeys';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form, HotkeyInput, Skeleton } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import hotkeyMeta from '@/locales/default/hotkey';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type HotkeyItem } from '@/types/hotkey';

const HotkeySetting = memo(() => {
  const { t } = useTranslation(['setting', 'hotkey']);
  const [form] = Form.useForm();

  const { hotkey } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const clearHotkeyBinding = (id: HotkeyItem['id']) => {
    if (!hotkey[id]) return;

    form.setFieldValue(id, '');
    save(() => setSettings({ hotkey: { [id]: '' } }));
  };

  const mapHotkeyItem = (item: HotkeyItem) => {
    const hotkeyConflicts = Object.entries(hotkey)
      .map(([key, value]) => {
        if (key === item.id) return false;
        return value;
      })
      .filter(Boolean) as string[];

    return {
      children: (
        <HotkeyInput
          allowClear={!item.nonEditable}
          disabled={item.nonEditable}
          hotkeyConflicts={hotkeyConflicts}
          placeholder={t('hotkey.record')}
          resetValue={item.keys}
          texts={{ clear: t('hotkey.clearBinding') }}
          onClear={() => void clearHotkeyBinding(item.id)}
        />
      ),
      desc: hotkeyMeta[`${item.id}.desc`] ? t(`${item.id}.desc`, { ns: 'hotkey' }) : undefined,
      label: t(`${item.id}.title`, { ns: 'hotkey' }),
      name: item.id,
    };
  };

  const essential: FormGroupItemType = {
    children: HOTKEYS_REGISTRATION.filter((item) => item.group === HotkeyGroupEnum.Essential).map(
      (item) => mapHotkeyItem(item),
    ),
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: (
      <SettingsSearchAnchor id={'hotkey-essential'}>
        {t('hotkey.group.essential')}
      </SettingsSearchAnchor>
    ),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={hotkey}
      items={[essential]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={(values) => save(() => setSettings({ hotkey: values }))}
      {...FORM_STYLE}
    />
  );
});

export default HotkeySetting;
