'use client';

import { Switch } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { DisplaySectionSkeleton } from '@/components/Skeleton/Settings/tabs/Conversation';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';

import { FontSizeControl } from './FontSize';
import LinkIconPreview from './LinkIconPreview';

/** How messages render: text size, link icons and the per-reply usage row. */
const Display = memo(() => {
  const { t } = useTranslation('setting');
  const fontSize = useUserStore(userGeneralSettingsSelectors.fontSize);
  const enableMessageLinkIcon = useUserStore(
    (s) => settingsSelectors.currentSettings(s).general.enableMessageLinkIcon ?? true,
  );
  const showMessageUsage = useUserStore(userGeneralSettingsSelectors.showMessageUsage);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const form = useForm();

  if (!isUserStateInit) return <DisplaySectionSkeleton />;

  const group: FormGroupItem = {
    children: [
      {
        children: (
          <FontSizeControl
            value={fontSize}
            onChange={(value) => save(() => setSettings({ general: { fontSize: value } }))}
          />
        ),
        desc: t('settingChatAppearance.fontSize.desc'),
        label: (
          <SettingsSearchAnchor id={'conversation-font-size'}>
            {t('settingChatAppearance.fontSize.title')}
          </SettingsSearchAnchor>
        ),
        layout: 'vertical',
        minWidth: '100%',
      },
      {
        children: (
          <Switch
            checked={enableMessageLinkIcon}
            onChange={(checked) =>
              save(() => setSettings({ general: { enableMessageLinkIcon: checked } }))
            }
          />
        ),
        desc: <LinkIconPreview />,
        label: (
          <SettingsSearchAnchor id={'conversation-link-icon'}>
            {t('settingChatAppearance.linkIcon.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      {
        children: (
          <Switch
            checked={showMessageUsage}
            onChange={(checked) =>
              save(() => setSettings({ general: { showMessageUsage: checked } }))
            }
          />
        ),
        desc: t('settingChatAppearance.showMessageUsage.desc'),
        label: (
          <SettingsSearchAnchor id={'conversation-message-usage'}>
            {t('settingChatAppearance.showMessageUsage.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingConversation.display.title'),
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

Display.displayName = 'ConversationDisplay';

export default Display;
