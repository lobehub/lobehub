'use client';

import { HotkeyGroupEnum, HotkeyScopeEnum, MAIL_HOTKEY_IDS } from '@lobechat/const/hotkeys';
import { HotkeyInput } from '@lobehub/ui';
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
import { settingsSelectors } from '@/store/user/selectors';
import { type HotkeyItem } from '@/types/hotkey';
import { type UserHotkeyConfig } from '@/types/user/settings';

const MailHotkeySetting = memo(() => {
  const { t } = useTranslation(['setting', 'hotkey']);
  const { hotkey } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
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
    // On the mail page only the other mail keys and the global combinations are
    // live; a bare global key belongs to the one page that mounts it.
    const hotkeyConflicts = HOTKEYS_REGISTRATION.filter(
      (other) =>
        other.id !== item.id &&
        (MAIL_HOTKEY_IDS.has(other.id) ||
          (other.scopes?.includes(HotkeyScopeEnum.Global) && other.keys.includes('+'))),
    )
      .map((other) => hotkey[other.id])
      .filter(Boolean);

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

  const mail: FormGroupItem<UserHotkeyConfig> = {
    children: HOTKEYS_REGISTRATION.filter((item) => item.group === HotkeyGroupEnum.Mail).map(
      (item) => mapHotkeyItem(item),
    ),
    extra:
      saveStatus === 'idle' ? undefined : (
        <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
      ),
    title: <SettingsSearchAnchor id={'hotkey-mail'}>{t('hotkey.group.mail')}</SettingsSearchAnchor>,
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[mail]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default MailHotkeySetting;
