'use client';

import { HotkeyGroupEnum, KeyEnum } from '@lobechat/const/hotkeys';
import { combineKeys, Hotkey, HotkeyInput, Select } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { ConversationHotkeysSkeleton } from '@/components/Skeleton/Settings/tabs/Hotkey';
import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { preferenceSelectors, settingsSelectors } from '@/store/user/selectors';
import { type HotkeyItem } from '@/types/hotkey';
import { type UserHotkeyConfig } from '@/types/user/settings';

const HotkeySetting = memo(() => {
  const { t } = useTranslation(['setting', 'hotkey']);
  const { hotkey } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [useCmdEnterToSend, updatePreference] = useUserStore((s) => [
    preferenceSelectors.useCmdEnterToSend(s),
    s.updatePreference,
  ]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const form = useForm({
    initialValues: hotkey,
    values: hotkey,
    onValuesChange: (values) => save(() => setSettings({ hotkey: values })),
  });

  if (!isUserStateInit) return <ConversationHotkeysSkeleton />;

  const clearHotkeyBinding = (id: HotkeyItem['id']) => {
    if (!hotkey[id]) return;

    form.setValue(id, '');
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
      label: t(`${item.id}.title`, { ns: 'hotkey' }),
      name: item.id,
    };
  };

  /**
   * The send key is a user preference (`useCmdEnterToSend`), not a hotkey binding, so
   * this row has no form `name` and saves through `updatePreference` on its own.
   */
  const sendKeyItem = {
    children: (
      <Select
        style={{ minWidth: 160 }}
        value={useCmdEnterToSend ? 'cmdEnter' : 'enter'}
        options={[
          { label: <Hotkey keys={KeyEnum.Enter} variant={'borderless'} />, value: 'enter' },
          {
            label: (
              <Hotkey keys={combineKeys([KeyEnum.Mod, KeyEnum.Enter])} variant={'borderless'} />
            ),
            value: 'cmdEnter',
          },
        ]}
        onChange={(value) =>
          save(() => updatePreference({ useCmdEnterToSend: value === 'cmdEnter' }))
        }
      />
    ),
    desc: t('hotkey.sendKey.desc'),
    label: (
      <SettingsSearchAnchor id={'hotkey-send-key'}>
        {t('hotkey.sendKey.title')}
      </SettingsSearchAnchor>
    ),
  };

  const conversation: FormGroupItem<UserHotkeyConfig> = {
    children: [
      sendKeyItem,
      ...HOTKEYS_REGISTRATION.filter((item) => item.group === HotkeyGroupEnum.Conversation).map(
        (item) => mapHotkeyItem(item),
      ),
    ],
    extra:
      saveStatus === 'idle' ? undefined : (
        <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
      ),
    title: (
      <SettingsSearchAnchor id={'hotkey-conversation'}>
        {t('hotkey.group.conversation')}
      </SettingsSearchAnchor>
    ),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[conversation]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default HotkeySetting;
