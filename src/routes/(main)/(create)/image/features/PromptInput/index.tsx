'use client';

import { ModelIcon } from '@lobehub/icons';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Switch, Tabs } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { Images } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { loginRequired } from '@/components/Error/loginRequiredNotification';
import Action from '@/features/ChatInput/ActionBar/components/Action';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import PromptTransformAction from '@/features/PromptTransform/PromptTransformAction';
import { useFetchAiImageConfig } from '@/hooks/useFetchAiImageConfig';
import { useIsDark } from '@/hooks/useIsDark';
import { usePermission } from '@/hooks/usePermission';
import { useQueryState } from '@/hooks/useQueryParam';
import {
  ConfigAction,
  GenerationMediaModeSegment,
  GenerationModelNotice,
  GenerationPromptInput,
  GenerationVisibilitySelector,
  InlineImageReference,
  useImageGenerationModelNotice,
} from '@/routes/(main)/(create)/features/GenerationInput';
import {
  CfgSliderInput,
  DimensionControlGroup,
  ImageNum,
  QualitySelect,
  ResolutionSelect,
  SeedNumberInput,
  SizeSelect,
  StepsSliderInput,
} from '@/routes/(main)/(create)/image/features/ConfigPanel';
import ImageModelItem from '@/routes/(main)/(create)/image/features/ConfigPanel/components/ModelSelect/ImageModelItem';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useImageStore } from '@/store/image';
import {
  createImageSelectors,
  generationTopicSelectors,
  imageGenerationConfigSelectors,
} from '@/store/image/selectors';
import {
  useDimensionControl,
  useGenerationConfigParam,
} from '@/store/image/slices/generationConfig/hooks';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import PromptTitle from './Title';
import { useImageReferenceUpload } from './useImageReferenceUpload';

interface PromptInputProps {
  disableAnimation?: boolean;
  showTitle?: boolean;
}

const isSupportedParamSelector = imageGenerationConfigSelectors.isSupportedParam;

interface SwitchItemProps {
  label: string;
  paramName: 'watermark' | 'webSearch';
}

const SwitchItem = memo<SwitchItemProps>(({ label, paramName }) => {
  const { allowed: canCreate } = usePermission('create_content');
  const { value, setValue } = useGenerationConfigParam(paramName);

  return (
    <Flexbox horizontal align="center" justify="space-between" padding={'0 2px'}>
      <Text weight={500}>{label}</Text>
      <Switch
        checked={!!value}
        disabled={!canCreate}
        onChange={(checked) => {
          if (!canCreate) return;

          setValue(checked as any);
        }}
      />
    </Flexbox>
  );
});

const PromptExtendItem = memo(() => {
  const { t } = useTranslation('image');
  const { allowed: canCreate } = usePermission('create_content');
  const { value, setValue, enumValues } = useGenerationConfigParam('promptExtend');

  if (enumValues && enumValues.length > 0) {
    const options = enumValues.map((item) => ({
      disabled: !canCreate,
      key: item,
      label: item,
    }));

    return (
      <Flexbox gap={6}>
        <Text weight={500}>{t('config.promptExtend.label')}</Text>
        <Tabs
          activeKey={value as string}
          items={options}
          style={{ width: '100%' }}
          styles={{
            list: { display: 'flex', width: '100%' },
            tab: { flex: 1 },
          }}
          onChange={(key) => {
            if (!canCreate) return;

            setValue(key as any);
          }}
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" justify="space-between" padding={'0 2px'}>
      <Text weight={500}>{t('config.promptExtend.label')}</Text>
      <Switch
        checked={!!value}
        disabled={!canCreate}
        onChange={(checked) => {
          if (!canCreate) return;

          setValue(checked as any);
        }}
      />
    </Flexbox>
  );
});

const PromptInput = ({ showTitle = false }: PromptInputProps) => {
  const isDarkMode = useIsDark();
  const { t } = useTranslation('image');
  const { allowed: canCreate } = usePermission('create_content');
  const { value, setValue } = useGenerationConfigParam('prompt');
  const {
    canDropImage,
    handleAddImage,
    handleRemoveImage,
    handleUploadFiles,
    imagePreviewUrls,
    maxCount,
    maxFileSize,
    uploadingPreviews,
  } = useImageReferenceUpload();
  const isCreating = useImageStore(createImageSelectors.isCreating);
  const createImage = useImageStore((s) => s.createImage);
  const setModelAndProviderOnSelect = useImageStore((s) => s.setModelAndProviderOnSelect);
  const activeGenerationTopicId = useImageStore(generationTopicSelectors.activeGenerationTopicId);
  const activeGenerationTopic = useImageStore((s) =>
    activeGenerationTopicId
      ? generationTopicSelectors.getGenerationTopicById(activeGenerationTopicId)(s)
      : undefined,
  );
  const newGenerationTopicVisibility = useImageStore(
    generationTopicSelectors.newGenerationTopicVisibility,
  );
  const setNewGenerationTopicVisibility = useImageStore((s) => s.setNewGenerationTopicVisibility);
  const currentModel = useImageStore(imageGenerationConfigSelectors.model);
  const currentProvider = useImageStore(imageGenerationConfigSelectors.provider);
  const isInit = useImageStore((s) => s.isInit);
  const isSupportQuality = useImageStore(isSupportedParamSelector('quality'));
  const isSupportResolution = useImageStore(isSupportedParamSelector('resolution'));
  const isSupportSize = useImageStore(isSupportedParamSelector('size'));
  const isSupportSeed = useImageStore(isSupportedParamSelector('seed'));
  const isSupportSteps = useImageStore(isSupportedParamSelector('steps'));
  const isSupportCfg = useImageStore(isSupportedParamSelector('cfg'));
  const isSupportPromptExtend = useImageStore(isSupportedParamSelector('promptExtend'));
  const isSupportWatermark = useImageStore(isSupportedParamSelector('watermark'));
  const isSupportWebSearch = useImageStore(isSupportedParamSelector('webSearch'));
  const isLogin = useUserStore(authSelectors.isLogin);
  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );
  const { notice: modelNotice, isModelUnavailable } = useImageGenerationModelNotice();
  const { showDimensionControl } = useDimensionControl();

  useFetchAiImageConfig();

  const [promptParam, setPromptParam] = useQueryState('prompt');
  const [modelParam, setModelParam] = useQueryState('model');
  const hasProcessedPrompt = useRef(false);
  const hasProcessedModel = useRef(false);

  const handleGenerate = async () => {
    if (!canCreate) return;

    if (!isLogin) {
      loginRequired.redirect({ timeout: 2000 });
      return;
    }

    await createImage();
  };

  useEffect(() => {
    if (modelParam && !hasProcessedModel.current && isInit) {
      const targetModel = modelParam;

      for (const providerGroup of enabledImageModelList) {
        const found = providerGroup.children.some((m) => m.id === targetModel);
        if (found) {
          setModelAndProviderOnSelect(targetModel, providerGroup.id);
          break;
        }
      }

      hasProcessedModel.current = true;
      setModelParam(null);
    }
  }, [modelParam, isInit, enabledImageModelList, setModelAndProviderOnSelect, setModelParam]);

  useEffect(() => {
    if (promptParam && !hasProcessedPrompt.current && isLogin && canCreate) {
      // Bail WITHOUT consuming the param while the model deep-link is still settling
      // or the provider runtime config isn't ready — otherwise a valid deep link
      // permanently skips auto-generate (see lobehub/lobehub#17400):
      // 1. `?model=` still present: the model effect hasn't applied it yet, so
      //    `isModelUnavailable` in this closure is stale (from the pre-model render).
      //    Consuming now would set `hasProcessedPrompt` / clear the param before the
      //    model resolves. Instead we wait; once the model effect clears `modelParam`
      //    this effect re-runs with a fresh `isModelUnavailable` for the applied model.
      // 2. Config not ready: the resolver returns undefined (so `isModelUnavailable`
      //    is `false`) while the aiProvider runtime state is still loading, which would
      //    auto-fire against a possibly-disabled provider. Wait until it settles.
      // 3. Generation config not initialized: before `initializeImageConfig` finishes,
      //    the selection is still the hard-coded default, so availability would be
      //    evaluated against a model the init step is about to replace.
      if (modelParam || !isModelConfigReady || !isInit) return;

      const decodedPrompt = decodeURIComponent(promptParam);
      setValue(decodedPrompt);
      hasProcessedPrompt.current = true;
      setPromptParam(null);

      // Config is ready and the selected model is genuinely unavailable — this path
      // bypasses the generate button, so without the guard it would fire a request
      // against a disabled provider (see lobehub/lobehub#17400).
      if (isModelUnavailable) return;

      const timeoutId = window.setTimeout(async () => {
        await createImage();
      }, 100);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, [
    promptParam,
    modelParam,
    isLogin,
    canCreate,
    isModelConfigReady,
    isInit,
    isModelUnavailable,
    setValue,
    setPromptParam,
    createImage,
  ]);

  const showInlineRef = canDropImage;
  const hasRefImages = imagePreviewUrls.length > 0;
  const displayVisibility = activeGenerationTopic
    ? activeGenerationTopic.visibility === 'private'
      ? 'private'
      : 'public'
    : newGenerationTopicVisibility;
  const visibilityLockedReason = activeGenerationTopicId
    ? t('topic.visibility.existingLocked')
    : undefined;

  return (
    <Flexbox gap={32} width={'100%'}>
      {showTitle && <PromptTitle />}
      <GenerationModelNotice notice={modelNotice} ns={'image'} />
      <GenerationPromptInput
        disableGenerate={!isInit || isModelUnavailable}
        disabled={!canCreate}
        generateLabel={t('generation.actions.generate')}
        generatingLabel={t('generation.status.generating')}
        isCreating={isCreating}
        isDarkMode={isDarkMode}
        value={value}
        inlineContent={
          showInlineRef ? (
            <InlineImageReference
              images={imagePreviewUrls}
              maxCount={maxCount}
              maxFileSize={maxFileSize}
              uploadingPreviews={uploadingPreviews}
              onAdd={handleAddImage}
              onRemove={handleRemoveImage}
              onUploadFiles={handleUploadFiles}
            />
          ) : undefined
        }
        leftActions={
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={canCreate ? undefined : { opacity: 0.5, pointerEvents: 'none' }}
          >
            <GenerationMediaModeSegment mode={'image'} />
            <ModelSwitchPanel
              ModelItemComponent={ImageModelItem}
              enabledList={enabledImageModelList}
              model={currentModel ?? undefined}
              openOnHover={false}
              placement="topLeft"
              pricingMode="image"
              provider={currentProvider ?? undefined}
              onModelChange={async ({ model, provider }) => {
                if (!canCreate) return;

                setModelAndProviderOnSelect(model, provider);
              }}
            >
              <ActionIcon
                icon={<ModelIcon model={currentModel ?? ''} size={22} />}
                size={{
                  blockSize: 36,
                  size: 20,
                }}
              />
            </ModelSwitchPanel>
            <ConfigAction
              title={t('config.title', { defaultValue: 'Config' })}
              content={
                <Flexbox gap={12}>
                  {isSupportQuality && (
                    <Flexbox gap={6}>
                      <Text fontSize={12}>{t('config.quality.label')}</Text>
                      <QualitySelect />
                    </Flexbox>
                  )}
                  {isSupportResolution && (
                    <Flexbox gap={6}>
                      <Text fontSize={12}>{t('config.resolution.label')}</Text>
                      <ResolutionSelect />
                    </Flexbox>
                  )}
                  {isSupportSize && (
                    <Flexbox gap={6}>
                      <Text fontSize={12}>{t('config.size.label')}</Text>
                      <SizeSelect />
                    </Flexbox>
                  )}
                  {showDimensionControl && <DimensionControlGroup />}
                  {isSupportSteps && (
                    <Flexbox gap={6}>
                      <Text fontSize={12}>{t('config.steps.label')}</Text>
                      <StepsSliderInput />
                    </Flexbox>
                  )}
                  {isSupportCfg && (
                    <Flexbox gap={6}>
                      <Text fontSize={12}>{t('config.cfg.label')}</Text>
                      <CfgSliderInput />
                    </Flexbox>
                  )}
                  {isSupportSeed && (
                    <Flexbox gap={6}>
                      <Text fontSize={12}>{t('config.seed.label')}</Text>
                      <SeedNumberInput />
                    </Flexbox>
                  )}
                  {(isSupportWatermark || isSupportPromptExtend || isSupportWebSearch) && (
                    <Divider style={{ marginBlock: 4 }} />
                  )}
                  {isSupportWatermark && (
                    <SwitchItem label={t('config.watermark.label')} paramName={'watermark'} />
                  )}
                  {isSupportPromptExtend && <PromptExtendItem />}
                  {isSupportWebSearch && (
                    <SwitchItem label={t('config.webSearch.label')} paramName={'webSearch'} />
                  )}
                </Flexbox>
              }
            />
            <Action
              icon={Images}
              title={t('config.imageNum.label')}
              trigger={'click'}
              popover={{
                content: <ImageNum />,
                minWidth: 220,
                title: t('config.imageNum.label'),
              }}
            />
          </Flexbox>
        }
        placeholder={
          hasRefImages ? t('config.prompt.placeholderWithRef') : t('config.prompt.placeholder')
        }
        rightActions={
          <>
            <PromptTransformAction
              mode={'image'}
              prompt={value}
              onPromptChange={(next) => {
                if (!canCreate) return;

                setValue(next as any);
              }}
            />
            <GenerationVisibilitySelector
              disabledReason={visibilityLockedReason}
              visibility={displayVisibility}
              onChange={setNewGenerationTopicVisibility}
            />
          </>
        }
        onGenerate={handleGenerate}
        onValueChange={setValue}
      />
    </Flexbox>
  );
};

export default PromptInput;
