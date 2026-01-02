'use client';

import {
  Flexbox,
  FormGroup,
  Icon,
  Segmented,
  Select,
  Skeleton,
  SliderWithInput,
  highlighterThemes,
  mermaidThemes,
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
        extra={
          <Flexbox align={'center'} gap={8} horizontal>
            {loadingStates.transitionMode && (
              <Icon icon={Loader2Icon} size={16} spin style={{ opacity: 0.5 }} />
            )}
            <Segmented
              onChange={(value) => handleChange('transitionMode', value)}
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
              value={general.transitionMode}
              variant={'outlined'}
            />
          </Flexbox>
        }
        gap={16}
        title={t('settingChatAppearance.transitionMode.title')}
        variant={'filled'}
      >
        <ChatTransitionPreview key={general.transitionMode} mode={general.transitionMode} />
      </FormGroup>

      <FormGroup
        collapsible={false}
        desc={t('settingChatAppearance.fontSize.desc')}
        extra={
          <Flexbox align={'center'} gap={8} horizontal>
            {loadingStates.fontSize && (
              <Icon icon={Loader2Icon} size={16} spin style={{ opacity: 0.5 }} />
            )}
            <SliderWithInput
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
              max={18}
              min={12}
              onChange={(value) => handleChange('fontSize', value)}
              step={1}
              style={{
                width: 240,
              }}
              value={general.fontSize}
            />
          </Flexbox>
        }
        gap={16}
        title={t('settingChatAppearance.fontSize.title')}
        variant={'filled'}
      >
        <ChatPreview fontSize={general.fontSize} />
      </FormGroup>

      <FormGroup
        collapsible={false}
        extra={
          <Flexbox align={'center'} gap={8} horizontal>
            {loadingStates.highlighterTheme && (
              <Icon icon={Loader2Icon} size={16} spin style={{ opacity: 0.5 }} />
            )}
            <Select
              onChange={(value) => handleChange('highlighterTheme', value)}
              options={highlighterThemes.map((item) => ({
                label: item.displayName,
                value: item.id,
              }))}
              style={{
                width: 240,
              }}
              value={general.highlighterTheme}
            />
          </Flexbox>
        }
        gap={16}
        title={t('settingChatAppearance.highlighterTheme.title')}
        variant={'filled'}
      >
        <HighlighterPreview theme={general.highlighterTheme} />
      </FormGroup>

      <FormGroup
        extra={
          <Flexbox align={'center'} gap={8} horizontal>
            {loadingStates.mermaidTheme && (
              <Icon icon={Loader2Icon} size={16} spin style={{ opacity: 0.5 }} />
            )}
            <Select
              onChange={(value) => handleChange('mermaidTheme', value)}
              options={mermaidThemes.map((item) => ({
                label: item.displayName,
                value: item.id,
              }))}
              style={{
                width: 240,
              }}
              value={general.mermaidTheme}
            />
          </Flexbox>
        }
        gap={16}
        title={t('settingChatAppearance.mermaidTheme.title')}
        variant={'filled'}
      >
        <MermaidPreview theme={general.mermaidTheme} />
      </FormGroup>
    </>
  );
});

export default ChatAppearance;
