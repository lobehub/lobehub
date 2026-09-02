'use client';

import { Flexbox, Form, FormGroup, highlighterThemes, mermaidThemes, Skeleton } from '@lobehub/ui';
import { Select, Switch, Tabs } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

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

      <Form
        collapsible={false}
        itemsType={'group'}
        variant={'filled'}
        items={[
          {
            children: [
              {
                children: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    {renderSaveHint('enableAutoScrollOnStreaming')}
                    <Switch
                      checked={general.enableAutoScrollOnStreaming ?? true}
                      onChange={(checked) => handleChange('enableAutoScrollOnStreaming', checked)}
                    />
                  </Flexbox>
                ),
                label: t('settingChatAppearance.autoScrollOnStreaming.title'),
                minWidth: undefined,
              },
              {
                children: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    {renderSaveHint('expandWorkflowWhileStreaming')}
                    <Switch
                      checked={general.expandWorkflowWhileStreaming ?? false}
                      onChange={(checked) => handleChange('expandWorkflowWhileStreaming', checked)}
                    />
                  </Flexbox>
                ),
                label: t('settingChatAppearance.workflowStreamingExpand.title'),
                minWidth: undefined,
              },
              {
                children: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    {renderSaveHint('enableMessageLinkIcon')}
                    <Switch
                      checked={general.enableMessageLinkIcon ?? true}
                      onChange={(checked) => handleChange('enableMessageLinkIcon', checked)}
                    />
                  </Flexbox>
                ),
                desc: <LinkIconPreview />,
                label: t('settingChatAppearance.linkIcon.title'),
                minWidth: undefined,
              },
            ],
            title: t('settingChatAppearance.chatBehavior.title'),
          },
        ]}
        {...FORM_STYLE}
      />

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
