'use client';

import {
  Flexbox,
  FormGroup,
  highlighterThemes,
  Icon,
  LobeSwitch as Switch,
  mermaidThemes,
  Segmented,
  Select,
  Skeleton,
  SliderWithInput,
} from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import ChatPreview from './ChatPreview';
import ChatTransitionPreview from './ChatTransitionPreview';
import HighlighterPreview from './HighlighterPreview';
import MermaidPreview from './MermaidPreview';

const ChatAppearance = memo(() => {
  const { t } = useTranslation('setting');
  const { general } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const handleChange = async (key: string, value: any) => {
    setLoadingStates((prev) => ({ ...prev, [key]: true }));
    await setSettings({ general: { [key]: value } });
    setLoadingStates((prev) => ({ ...prev, [key]: false }));
  };

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
            {loadingStates.transitionMode && (
              <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
            )}
            <Segmented
              value={general.transitionMode}
              variant={'outlined'}
              options={[
                {
                  label: t('settingChatAppearance.transitionMode.options.none.value'),
                  value: 'none',
                },
                {
                  label: t('settingChatAppearance.transitionMode.options.fadeIn'),
                  value: 'fadeIn',
                },
                {
                  label: t('settingChatAppearance.transitionMode.options.smooth'),
                  value: 'smooth',
                },
              ]}
              onChange={(value) => handleChange('transitionMode', value)}
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
            {loadingStates.enableAutoScrollOnStreaming && (
              <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
            )}
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
        desc={t('settingChatAppearance.fontSize.desc')}
        gap={16}
        title={t('settingChatAppearance.fontSize.title')}
        variant={'filled'}
        extra={
          <Flexbox horizontal align={'center'} gap={8}>
            {loadingStates.fontSize && (
              <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
            )}
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
            {loadingStates.highlighterTheme && (
              <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
            )}
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
            {loadingStates.mermaidTheme && (
              <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
            )}
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
