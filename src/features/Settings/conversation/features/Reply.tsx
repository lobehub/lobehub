'use client';

import { Flexbox, Select, Switch } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { ReplySectionSkeleton } from '@/components/Skeleton/Settings/tabs/Conversation';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { localeOptions } from '@/locales/resources';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type UserGeneralConfig } from '@/types/user/settings';

/** How the Agent replies: its language, and what a running turn shows. */
const Reply = memo(() => {
  const { t } = useTranslation('setting');
  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const form = useForm();

  if (!isUserStateInit) return <ReplySectionSkeleton />;

  const update = (value: Partial<UserGeneralConfig>) => save(() => setSettings({ general: value }));

  const group: FormGroupItem = {
    children: [
      {
        children: (
          <Flexbox horizontal justify={'flex-end'}>
            <Select
              value={general.responseLanguage || 'auto'}
              options={[
                { label: t('settingCommon.responseLanguage.auto'), value: 'auto' },
                ...localeOptions,
              ]}
              style={{
                width: '50%',
              }}
              onChange={(value) => update({ responseLanguage: value === 'auto' ? '' : value })}
            />
          </Flexbox>
        ),
        label: (
          <SettingsSearchAnchor id={'conversation-response-language'}>
            {t('settingCommon.responseLanguage.title')}
          </SettingsSearchAnchor>
        ),
      },
      {
        children: (
          <Switch
            checked={general.enableAutoScrollOnStreaming ?? true}
            onChange={(checked) => update({ enableAutoScrollOnStreaming: checked })}
          />
        ),
        label: (
          <SettingsSearchAnchor id={'conversation-auto-scroll'}>
            {t('settingChatAppearance.autoScrollOnStreaming.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      {
        children: (
          <Switch
            checked={general.expandWorkflowWhileStreaming ?? false}
            onChange={(checked) => update({ expandWorkflowWhileStreaming: checked })}
          />
        ),
        label: (
          <SettingsSearchAnchor id={'conversation-workflow-expand'}>
            {t('settingChatAppearance.workflowStreamingExpand.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      {
        children: (
          <Switch
            checked={general.showImageReadPreview ?? true}
            onChange={(checked) => update({ showImageReadPreview: checked })}
          />
        ),
        desc: t('settingChatAppearance.showImageReadPreview.desc'),
        label: (
          <SettingsSearchAnchor id={'conversation-image-read-preview'}>
            {t('settingChatAppearance.showImageReadPreview.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingConversation.reply.title'),
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

Reply.displayName = 'ConversationReply';

export default Reply;
