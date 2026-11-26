'use client';

import { Flexbox, Switch } from '@lobehub/ui';
import { Form, type FormFieldProps, type FormGroupItem, useForm } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { ChatAssistSectionSkeleton } from '@/components/Skeleton/Settings/tabs/Conversation';
import { FORM_STYLE } from '@/const/layoutTokens';
import ModelSelect from '@/features/ModelSelect';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { PERSONAL_SYSTEM_AGENT_KEYS, type PersonalSystemAgentKey } from '@/types/user/settings';

import { useChatAssistRow } from './useChatAssistRow';

interface ChatAssistControlProps {
  itemKey: PersonalSystemAgentKey;
}

/** One row's switch + model picker, with the row's own save hint. */
const ChatAssistControl = memo<ChatAssistControlProps>(({ itemKey }) => {
  const { t } = useTranslation('setting');
  const {
    loading,
    saveState: { status: saveStatus, lastSavedAt, retry },
    update,
    value,
  } = useChatAssistRow(itemKey);
  const featureDisabled = value.enabled === false;

  return (
    <Flexbox
      align="center"
      direction="horizontal"
      gap={12}
      justify="flex-end"
      style={{ width: 'min(100%, 448px)' }}
    >
      {saveStatus !== 'idle' && (
        <AutoSaveHint
          lastUpdatedTime={lastSavedAt}
          saveStatus={saveStatus}
          style={{ flex: 'none' }}
          onRetry={retry}
        />
      )}
      {!featureDisabled && (
        <ModelSelect
          showAbility={false}
          style={{ minWidth: 0, width: '100%' }}
          value={value}
          onChange={({ model, provider }) => update({ model, provider })}
        />
      )}
      <Switch
        aria-label={t(`systemAgent.${itemKey}.title`)}
        checked={value.enabled}
        loading={loading}
        onChange={(enabled) => update({ enabled })}
      />
    </Flexbox>
  );
});

ChatAssistControl.displayName = 'ChatAssistControl';

/**
 * The chat-assist entries (follow-up chips, input completion) shown on the
 * Conversation settings page. They are personal, so unlike `ServiceModelForm`
 * nothing here is gated on workspace permissions: every member configures
 * their own.
 */
const ChatAssistForm = memo(() => {
  const { t } = useTranslation('setting');
  const systemAgentSettings = useUserStore(settingsSelectors.currentSystemAgent, isEqual);
  const [isUserStateInit, isUserStateInitError, refreshUserState] = useUserStore((s) => [
    s.isUserStateInit,
    s.isUserStateInitError,
    s.refreshUserState,
  ]);
  const form = useForm();

  if (!isUserStateInit) {
    if (isUserStateInitError)
      return (
        <AsyncError
          error={isUserStateInitError}
          variant={'block'}
          onRetry={() => refreshUserState()}
        />
      );
    // The same group the conversation route skeleton draws, so loading never
    // swaps between two shapes.
    return <ChatAssistSectionSkeleton />;
  }

  const items: FormFieldProps[] = PERSONAL_SYSTEM_AGENT_KEYS.map((key) => {
    const featureDisabled = systemAgentSettings[key].enabled === false;

    return {
      children: <ChatAssistControl itemKey={key} />,
      desc: t(`systemAgent.${key}.modelDesc`),
      label: (
        <SettingsSearchAnchor id={`conversation-${key}`}>
          <span style={{ opacity: featureDisabled ? 0.45 : 1 }}>
            {t(`systemAgent.${key}.title`)}
          </span>
        </SettingsSearchAnchor>
      ),
    } satisfies FormFieldProps;
  });

  const group: FormGroupItem = {
    children: items,
    desc: t('chatPreference.assist.desc'),
    title: t('chatPreference.assist.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[group]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
      itemMinWidth={undefined}
    />
  );
});

ChatAssistForm.displayName = 'ChatAssistForm';

export default ChatAssistForm;
