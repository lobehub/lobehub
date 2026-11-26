'use client';

import { KeyEnum } from '@lobechat/const/hotkeys';
import { DEFAULT_FOLLOW_UP_BEHAVIOR } from '@lobechat/types';
import { combineKeys, Flexbox, Hotkey, Select, Switch } from '@lobehub/ui';
import { Form, type FormFieldProps, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { SendingSectionSkeleton } from '@/components/Skeleton/Settings/tabs/Conversation';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';
import { type UserGeneralConfig } from '@/types/user/settings';
import { isMobileSurface } from '@/utils/mobileSurface';

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

/** How messages get into the conversation: send key, paste handling, sending mid-run. */
const Sending = memo(() => {
  const { t } = useTranslation(['setting', 'chat']);
  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const enablePasteAutoConvert = useUserStore(userGeneralSettingsSelectors.enablePasteAutoConvert);
  const enableVoiceMessage = useUserStore(userGeneralSettingsSelectors.enableVoiceMessage);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { sendKey, setSendKey } = useSendKeyPreference();
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const form = useForm();

  if (!isUserStateInit) return <SendingSectionSkeleton />;

  const update = (value: Partial<UserGeneralConfig>) => save(() => setSettings({ general: value }));

  // A touch keyboard has no modifier to pair with Enter, so the choice only
  // exists where hotkeys do.
  const sendKeyItem: FormFieldProps | undefined = isMobileSurface()
    ? undefined
    : {
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
          <SettingsSearchAnchor id={'conversation-send-key'}>
            {t('hotkey.sendMessage.title')}
          </SettingsSearchAnchor>
        ),
      };

  const followUpBehaviorItem: FormFieldProps = {
    children: (
      <Select
        style={{ width: 160 }}
        value={general.followUpBehavior ?? DEFAULT_FOLLOW_UP_BEHAVIOR}
        options={[
          {
            label: t('settingChatAppearance.followUpBehavior.options.queue'),
            value: 'queue',
          },
          {
            label: t('settingChatAppearance.followUpBehavior.options.steer'),
            value: 'steer',
          },
        ]}
        onChange={(value) => update({ followUpBehavior: value })}
      />
    ),
    desc: t('settingChatAppearance.followUpBehavior.desc'),
    label: t('settingChatAppearance.followUpBehavior.title'),
    minWidth: undefined,
  };

  const group: FormGroupItem = {
    children: [
      sendKeyItem,
      {
        children: (
          <Switch
            checked={enablePasteAutoConvert}
            onChange={(checked) => update({ enablePasteAutoConvert: checked })}
          />
        ),
        desc: t('settingChatAppearance.pasteAutoConvert.desc'),
        label: (
          <SettingsSearchAnchor id={'conversation-paste-auto-convert'}>
            {t('settingChatAppearance.pasteAutoConvert.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      {
        children: (
          <Switch
            checked={enableVoiceMessage}
            onChange={(checked) => update({ enableVoiceMessage: checked })}
          />
        ),
        desc: t('settingConversation.voiceMessage.desc'),
        label: (
          <SettingsSearchAnchor id={'conversation-voice-message'}>
            {t('settingConversation.voiceMessage.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      followUpBehaviorItem,
    ].filter((item): item is FormFieldProps => !!item),
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingConversation.input.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[group]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

Sending.displayName = 'ConversationSending';

export default Sending;
