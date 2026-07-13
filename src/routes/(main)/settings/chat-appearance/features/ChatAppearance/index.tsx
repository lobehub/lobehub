'use client';

import {
  Flexbox,
  FormGroup,
  highlighterThemes,
  mermaidThemes,
  Skeleton,
  SliderWithInput,
} from '@lobehub/ui';
import { Select, Switch, Tabs } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import ChatPreview from './ChatPreview';
import ChatTransitionPreview from './ChatTransitionPreview';
import HighlighterPreview from './HighlighterPreview';
import LinkIconPreview from './LinkIconPreview';
import MermaidPreview from './MermaidPreview';

const ChatAppearance = memo(() => {
  const { t } = useTranslation('setting');
  const { general } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const [savingKey, setSavingKey] = useState<string>();

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const handleChange = (key: string, value: any) => {
    setSavingKey(key);
    save(() => setSettings({ general: { [key]: value } }));
  };

  // Show the shared save-state hint only on the control the user last touched.
  const renderSaveHint = (key: string) =>
    savingKey === key && (
      <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
    );

  return (
    <>
      <FormGroup
        collapsible={false}
        desc={t('settingChatAppearance.transitionMode.desc')}
        gap={16}
        title={t('settingChatAppearance.transitionMode.title')}
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
              onChange={(key) => handleChange('transitionMode', key)}
            />
          </Flexbox>
        }
      >
        <ChatTransitionPreview key={general.transitionMode} mode={general.transitionMode} />
      </FormGroup>

      <FormGroup
        active={false}
        collapsible={false}
        desc={t('settingChatAppearance.autoScrollOnStreaming.desc')}
        title={t('settingChatAppearance.autoScrollOnStreaming.title')}
        variant={'filled'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('enableAutoScrollOnStreaming')}
            <Switch
              checked={general.enableAutoScrollOnStreaming ?? true}
              onChange={(checked) => handleChange('enableAutoScrollOnStreaming', checked)}
            />
          </Flexbox>
        }
      >
        {null}
      </FormGroup>

      <FormGroup
        collapsible={false}
        desc={t('settingChatAppearance.linkIcon.desc')}
        gap={16}
        title={t('settingChatAppearance.linkIcon.title')}
        variant={'filled'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('enableMessageLinkIcon')}
            <Switch
              checked={general.enableMessageLinkIcon ?? true}
              onChange={(checked) => handleChange('enableMessageLinkIcon', checked)}
            />
          </Flexbox>
        }
      >
        <LinkIconPreview />
      </FormGroup>

      <FormGroup
        collapsible={false}
        desc={t('settingChatAppearance.fontSize.desc')}
        gap={16}
        variant={'filled'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {renderSaveHint('fontSize')}
            <SliderWithInput
              max={18}
              min={12}
              step={1}
              value={general.fontSize}
              marks={{
                12: {
                  label: 'A',
                  style: {
                    fontSize: 12,
                    marginTop: 4,
                  },
                },
                14: {
                  label: t('settingChatAppearance.fontSize.marks.normal'),
                  style: {
                    fontSize: 14,
                    marginTop: 4,
                  },
                },
                18: {
                  label: 'A',
                  style: {
                    fontSize: 18,
                    marginTop: 4,
                  },
                },
              }}
              style={{
                width: 240,
              }}
              onChange={(value) => handleChange('fontSize', value)}
            />
          </Flexbox>
        }
        title={
          <SettingsSearchAnchor id={'appearance-font-size'}>
            {t('settingChatAppearance.fontSize.title')}
          </SettingsSearchAnchor>
        }
      >
        <ChatPreview fontSize={general.fontSize} />
      </FormGroup>

      <FormGroup
        collapsible={false}
        gap={16}
        title={t('settingChatAppearance.highlighterTheme.title')}
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
      >
        <HighlighterPreview key={general.highlighterTheme} theme={general.highlighterTheme} />
      </FormGroup>

      <FormGroup
        gap={16}
        title={t('settingChatAppearance.mermaidTheme.title')}
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
      >
        <MermaidPreview key={general.mermaidTheme} theme={general.mermaidTheme} />
      </FormGroup>
    </>
  );
});

export default ChatAppearance;
