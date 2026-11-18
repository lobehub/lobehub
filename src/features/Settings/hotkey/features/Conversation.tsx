'use client';

import { HotkeyGroupEnum, KeyEnum } from '@lobechat/const/hotkeys';
import { combineKeys, Flexbox, Hotkey, HotkeyInput, Select } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { ConversationHotkeysSkeleton } from '@/components/Skeleton/Settings/tabs/Hotkey';
import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type HotkeyItem } from '@/types/hotkey';
import { type UserHotkeyConfig } from '@/types/user/settings';

import { type SendKey, useSendKeyPreference } from './useSendKeyPreference';

const SendKeyLabel = memo<{ sendKey: SendKey }>(({ sendKey }) => (
  <Flexbox horizontal align={'center'} as={'span'} gap={4}>
    <Trans
      i18nKey={sendKey === 'enter' ? 'input.sendWithEnter' : 'input.sendWithCmdEnter'}
      ns={'chat'}
      components={{
        key: (
          <Hotkey
            as={'span'}
            keys={sendKey === 'enter' ? KeyEnum.Enter : combineKeys([KeyEnum.Mod, KeyEnum.Enter])}
            variant={'borderless'}
          />
        ),
      }}
    />
  </Flexbox>
));

const SEND_KEY_OPTIONS = (['enter', 'modEnter'] as const).map((sendKey) => ({
  label: <SendKeyLabel sendKey={sendKey} />,
  value: sendKey,
}));

const HotkeySetting = memo(() => {
  const { t } = useTranslation(['setting', 'hotkey', 'chat']);
  const { hotkey } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { sendKey, setSendKey } = useSendKeyPreference();
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

  // Stored in user preference rather than the hotkey map, so it is a controlled
  // field outside the hotkey form values.
  const sendKeyItem = {
    children: (
      <Select
        aria-label={t('hotkey.sendMessage.title')}
        options={SEND_KEY_OPTIONS}
        style={{ minWidth: 160 }}
        value={sendKey}
        onChange={(value: SendKey) => save(() => setSendKey(value))}
      />
    ),
    desc: t('hotkey.sendMessage.desc'),
    label: (
      <SettingsSearchAnchor id={'hotkey-send-message'}>
        {t('hotkey.sendMessage.title')}
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
