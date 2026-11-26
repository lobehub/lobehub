'use client';

import { Flexbox, highlighterThemes, mermaidThemes, Select, Tabs } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { ThemesSectionSkeleton } from '@/components/Skeleton/Settings/tabs/Conversation';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type UserGeneralConfig } from '@/types/user/settings';

import ChatTransitionPreview from './ChatTransitionPreview';
import HighlighterPreview from './HighlighterPreview';
import MermaidPreview from './MermaidPreview';

type ThemeKey = keyof Pick<
  UserGeneralConfig,
  'highlighterTheme' | 'mermaidTheme' | 'transitionMode'
>;

/** The previewed choices: reply transition, code highlight and Mermaid themes. */
const Themes = memo(() => {
  const { t } = useTranslation('setting');
  const { general } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const [savingKey, setSavingKey] = useState<ThemeKey>();

  if (!isUserStateInit) return <ThemesSectionSkeleton />;

  const handleChange = <K extends ThemeKey>(key: K, value: UserGeneralConfig[K]) => {
    setSavingKey(key);
    save(() => setSettings({ general: { [key]: value } }));
  };

  // Show the shared save-state hint only on the control the user last touched.
  const renderSaveHint = (key: ThemeKey) =>
    savingKey === key && (
      <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
    );

  return (
    <>
      <Form.Group
        collapsible={false}
        variant={'filled'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('transitionMode')}
            <Tabs
              activeKey={general.transitionMode}
              items={[
                {
                  key: 'none',
                  label: t('settingChatAppearance.transitionMode.options.none.value'),
                },
                {
                  key: 'fadeIn',
                  label: t('settingChatAppearance.transitionMode.options.fadeIn'),
                },
                {
                  key: 'smooth',
                  label: t('settingChatAppearance.transitionMode.options.smooth'),
                },
              ]}
              onChange={(key) =>
                handleChange('transitionMode', key as UserGeneralConfig['transitionMode'])
              }
            />
          </Flexbox>
        }
        title={
          <SettingsSearchAnchor id={'conversation-transition'}>
            {t('settingChatAppearance.transitionMode.title')}
          </SettingsSearchAnchor>
        }
      >
        <ChatTransitionPreview key={general.transitionMode} mode={general.transitionMode} />
      </Form.Group>

      <Form.Group
        collapsible={false}
        variant={'filled'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('highlighterTheme')}
            <Select
              value={general.highlighterTheme}
              options={highlighterThemes.map((item) => ({
                label: item.displayName,
                value: item.id,
              }))}
              style={{
                width: 240,
              }}
              onChange={(value) => handleChange('highlighterTheme', value)}
            />
          </Flexbox>
        }
        title={
          <SettingsSearchAnchor id={'conversation-highlighter-theme'}>
            {t('settingChatAppearance.highlighterTheme.title')}
          </SettingsSearchAnchor>
        }
      >
        <HighlighterPreview key={general.highlighterTheme} theme={general.highlighterTheme} />
      </Form.Group>

      <Form.Group
        variant={'filled'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('mermaidTheme')}
            <Select
              value={general.mermaidTheme}
              options={mermaidThemes.map((item) => ({
                label: item.displayName,
                value: item.id,
              }))}
              style={{
                width: 240,
              }}
              onChange={(value) => handleChange('mermaidTheme', value)}
            />
          </Flexbox>
        }
        title={
          <SettingsSearchAnchor id={'conversation-mermaid-theme'}>
            {t('settingChatAppearance.mermaidTheme.title')}
          </SettingsSearchAnchor>
        }
      >
        <MermaidPreview key={general.mermaidTheme} theme={general.mermaidTheme} />
      </Form.Group>
    </>
  );
});

Themes.displayName = 'ConversationThemes';

export default Themes;
