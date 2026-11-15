'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { loginRequired } from '@/components/Error/loginRequiredNotification';
import { ModelIcon } from '@/components/LobeIcons';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { useFetchAiMusicConfig } from '@/hooks/useFetchAiMusicConfig';
import { useIsDark } from '@/hooks/useIsDark';
import { usePermission } from '@/hooks/usePermission';
import { useQueryState } from '@/hooks/useQueryParam';
import {
  ConfigAction,
  GenerationMediaModeSegment,
  GenerationModelNotice,
  GenerationPromptBlockedNotice,
  GenerationPromptInput,
  GenerationVisibilitySelector,
  useMusicGenerationModelNotice,
} from '@/routes/(main)/(create)/features/GenerationInput';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useMusicStore } from '@/store/music';
import {
  createMusicSelectors,
  musicGenerationConfigSelectors,
  musicGenerationTopicSelectors,
} from '@/store/music/selectors';
import { useMusicGenerationConfigParam } from '@/store/music/slices/generationConfig/hooks';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import MusicModelItem from '../ModelSelect/MusicModelItem';
import AudioSettings, { useHasAudioSettings } from './AudioSettings';
import MusicParams from './MusicParams';
import PromptTitle from './Title';

const styles = stylex.create({
  // Same inset as the blocked-prompt notice so the hint does not touch the input border
  promptHint: {
    paddingBlockStart: '8px',
    paddingInline: '12px',
  },
});

interface PromptInputProps {
  disableAnimation?: boolean;
  showTitle?: boolean;
}

const PromptInput = memo<PromptInputProps>(({ showTitle = false }) => {
  const { t } = useTranslation('music');
  const isDarkMode = useIsDark();
  const { allowed: canCreate } = usePermission('create_content');
  const { value, setValue } = useMusicGenerationConfigParam('prompt');
  const isCreating = useMusicStore(createMusicSelectors.isCreating);
  const blockedPrompt = useMusicStore(createMusicSelectors.blockedPrompt);
  const dismissBlockedPrompt = useMusicStore((s) => s.dismissBlockedPrompt);
  const createMusic = useMusicStore((s) => s.createMusic);
  const canSubmit = useMusicStore(musicGenerationConfigSelectors.canSubmit);
  const promptMinLength = useMusicStore(musicGenerationConfigSelectors.promptMinLength);
  const isInit = useMusicStore((s) => s.isInit);
  const currentModel = useMusicStore(musicGenerationConfigSelectors.model);
  const currentProvider = useMusicStore(musicGenerationConfigSelectors.provider);
  const setModelAndProviderOnSelect = useMusicStore((s) => s.setModelAndProviderOnSelect);
  const activeGenerationTopicId = useMusicStore(
    musicGenerationTopicSelectors.activeGenerationTopicId,
  );
  const activeGenerationTopic = useMusicStore((s) =>
    activeGenerationTopicId
      ? musicGenerationTopicSelectors.getGenerationTopicById(activeGenerationTopicId)(s)
      : undefined,
  );
  const newGenerationTopicVisibility = useMusicStore(
    musicGenerationTopicSelectors.newGenerationTopicVisibility,
  );
  const setNewGenerationTopicVisibility = useMusicStore((s) => s.setNewGenerationTopicVisibility);
  const enabledMusicModelList = useAiInfraStore(aiProviderSelectors.enabledMusicModelList);
  const { notice: modelNotice, isModelUnavailable } = useMusicGenerationModelNotice();
  const isLogin = useUserStore(authSelectors.isLogin);
  const hasAudioSettings = useHasAudioSettings();
  useFetchAiMusicConfig();

  const isPromptBlocked = !!blockedPrompt && blockedPrompt === value;

  // `?model=` deep link picks the model once the config is initialized
  const [modelParam, setModelParam] = useQueryState('model');
  const hasProcessedModel = useRef(false);
  useEffect(() => {
    if (!modelParam || hasProcessedModel.current || !isInit) return;

    const group = enabledMusicModelList.find((p) => p.children.some((m) => m.id === modelParam));
    if (group) setModelAndProviderOnSelect(modelParam, group.id);

    hasProcessedModel.current = true;
    setModelParam(null);
  }, [modelParam, isInit, enabledMusicModelList, setModelAndProviderOnSelect, setModelParam]);

  const handleGenerate = async () => {
    if (!canCreate) return;

    if (!isLogin) {
      loginRequired.redirect();
      return;
    }

    try {
      await createMusic();
    } catch (error) {
      // The store already surfaced moderation and deprecation errors; keep the draft for a retry
      console.error('Failed to create music:', error);
    }
  };

  const displayVisibility = activeGenerationTopic
    ? activeGenerationTopic.visibility === 'private'
      ? 'private'
      : 'public'
    : newGenerationTopicVisibility;

  return (
    <Flexbox gap={32} width={'100%'}>
      {showTitle && <PromptTitle />}
      <GenerationModelNotice notice={modelNotice} ns={'music'} />
      <GenerationPromptInput
        bottomContent={<MusicParams disabled={!canCreate} />}
        canSubmit={canSubmit}
        disableGenerate={!isInit || isModelUnavailable}
        disabled={!canCreate}
        generateLabel={t('generation.actions.generate')}
        generatingLabel={t('generation.status.generating')}
        isCreating={isCreating}
        isDarkMode={isDarkMode}
        maxRows={4}
        minRows={2}
        placeholder={t('config.prompt.placeholder')}
        value={value}
        header={
          isPromptBlocked ? (
            <GenerationPromptBlockedNotice onClose={dismissBlockedPrompt} />
          ) : promptMinLength ? (
            <div className={stylex.props(styles.promptHint).className}>
              <Text fontSize={12} type={'warning'}>
                {t('config.prompt.minLength', { count: promptMinLength })}
              </Text>
            </div>
          ) : undefined
        }
        leftActions={
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={canCreate ? undefined : { opacity: 0.5, pointerEvents: 'none' }}
          >
            <GenerationMediaModeSegment mode={'music'} />
            <ModelSwitchPanel
              ModelItemComponent={MusicModelItem}
              enabledList={enabledMusicModelList}
              model={currentModel ?? undefined}
              openOnHover={false}
              placement="topLeft"
              provider={currentProvider ?? undefined}
              onModelChange={async ({ model, provider }) => {
                if (!canCreate) return;

                setModelAndProviderOnSelect(model, provider);
              }}
            >
              <ActionIcon
                icon={<ModelIcon model={currentModel ?? ''} size={22} />}
                title={t('config.model.label')}
                size={{
                  blockSize: 36,
                  size: 20,
                }}
              />
            </ModelSwitchPanel>
            {hasAudioSettings && (
              <ConfigAction content={<AudioSettings />} title={t('config.title')} />
            )}
          </Flexbox>
        }
        rightActions={
          <GenerationVisibilitySelector
            visibility={displayVisibility}
            disabledReason={
              activeGenerationTopicId ? t('topic.visibility.existingLocked') : undefined
            }
            onChange={setNewGenerationTopicVisibility}
          />
        }
        onGenerate={handleGenerate}
        onValueChange={(next) => setValue(next)}
      />
    </Flexbox>
  );
});

PromptInput.displayName = 'MusicPromptInput';

export default PromptInput;
