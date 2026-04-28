'use client';

import { ModelIcon } from '@lobehub/icons';
import { ActionIcon, Flexbox, Segmented, Text } from '@lobehub/ui';
import { Divider, Switch } from 'antd';
import { Images } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { loginRequired } from '@/components/Error/loginRequiredNotification';
import Action from '@/features/ChatInput/ActionBar/components/Action';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import PromptTransformAction from '@/features/PromptTransform/PromptTransformAction';
import { useFetchAiImageConfig } from '@/hooks/useFetchAiImageConfig';
import { useIsDark } from '@/hooks/useIsDark';
import { useQueryState } from '@/hooks/useQueryParam';
import {
  ConfigAction,
  GenerationMediaModeSegment,
  GenerationPromptInput,
  InlineImageReference,
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
  useAutoDimensions,
} from '@/routes/(main)/(create)/image/features/ConfigPanel';
import ImageModelItem from '@/routes/(main)/(create)/image/features/ConfigPanel/components/ModelSelect/ImageModelItem';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useImageStore } from '@/store/image';
import { createImageSelectors, imageGenerationConfigSelectors } from '@/store/image/selectors';
import {
  useDimensionControl,
  useGenerationConfigParam,
} from '@/store/image/slices/generationConfig/hooks';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import PromptTitle from './Title';

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
  const { value, setValue } = useGenerationConfigParam(paramName);

  return (
    <Flexbox horizontal align="center" justify="space-between" padding={'0 2px'}>
      <Text weight={500}>{label}</Text>
      <Switch checked={!!value} onChange={(checked) => setValue(checked as any)} />
    </Flexbox>
  );
});

const PromptExtendItem = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('promptExtend');

  if (enumValues && enumValues.length > 0) {
    const options = enumValues.map((item) => ({ label: item, value: item }));

    return (
      <Flexbox gap={6}>
        <Text weight={500}>{t('config.promptExtend.label')}</Text>
        <Segmented
          block
          options={options}
          style={{ width: '100%' }}
          value={value as string}
          variant="filled"
          onChange={(next) => setValue(String(next) as any)}
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" justify="space-between" padding={'0 2px'}>
      <Text weight={500}>{t('config.promptExtend.label')}</Text>
      <Switch checked={!!value} onChange={(checked) => setValue(checked as any)} />
    </Flexbox>
  );
});

const PromptInput = ({ showTitle = false }: PromptInputProps) => {
  const isDarkMode = useIsDark();
  const { t } = useTranslation('image');
  const { value, setValue } = useGenerationConfigParam('prompt');
  const { value: imageUrl, setValue: setImageUrl } = useGenerationConfigParam('imageUrl');
  const {
    value: imageUrls,
    setValue: setImageUrls,
    maxCount: imageUrlsMaxCount,
    maxFileSize: imageUrlsMaxFileSize,
  } = useGenerationConfigParam('imageUrls');
  const { maxFileSize: imageUrlMaxFileSize } = useGenerationConfigParam('imageUrl');
  const isCreating = useImageStore(createImageSelectors.isCreating);
  const createImage = useImageStore((s) => s.createImage);
  const setModelAndProviderOnSelect = useImageStore((s) => s.setModelAndProviderOnSelect);
  const currentModel = useImageStore(imageGenerationConfigSelectors.model);
  const currentProvider = useImageStore(imageGenerationConfigSelectors.provider);
  const isInit = useImageStore((s) => s.isInit);
  const isSupportImageUrl = useImageStore(isSupportedParamSelector('imageUrl'));
  const isSupportImageUrls = useImageStore(isSupportedParamSelector('imageUrls'));
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
  const { showDimensionControl } = useDimensionControl();
  const { autoSetDimensions, extractUrlAndDimensions } = useAutoDimensions();

  useFetchAiImageConfig();

  const [promptParam, setPromptParam] = useQueryState('prompt');
  const [modelParam, setModelParam] = useQueryState('model');
  const hasProcessedPrompt = useRef(false);
  const hasProcessedModel = useRef(false);

  const handleGenerate = async () => {
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
    if (promptParam && !hasProcessedPrompt.current && isLogin) {
      const decodedPrompt = decodeURIComponent(promptParam);
      setValue(decodedPrompt);
      hasProcessedPrompt.current = true;
      setPromptParam(null);

      const timeoutId = window.setTimeout(async () => {
        await createImage();
      }, 100);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, [promptParam, isLogin, setValue, setPromptParam, createImage]);

  const imagePreviewUrls = useMemo(
    () => [imageUrl, ...(imageUrls ?? [])].filter(Boolean) as string[],
    [imageUrl, imageUrls],
  );

  const handleAddImage = useCallback(
    (data: string | { dimensions?: { height: number; width: number }; url: string }) => {
      const { url, dimensions } = extractUrlAndDimensions(data);
      if (!url) return;

      if (dimensions) {
        autoSetDimensions(dimensions);
      }

      if (isSupportImageUrl && !imageUrl) {
        setImageUrl(url);
      } else if (isSupportImageUrls) {
        setImageUrls([...(imageUrls ?? []), url] as any);
      } else if (isSupportImageUrl) {
        setImageUrl(url);
      }
    },
    [
      isSupportImageUrl,
      isSupportImageUrls,
      imageUrl,
      imageUrls,
      setImageUrl,
      setImageUrls,
      autoSetDimensions,
      extractUrlAndDimensions,
    ],
  );

  const handleRemoveImage = useCallback(
    (url: string) => {
      if (url === imageUrl) {
        setImageUrl(null);
      } else {
        setImageUrls((imageUrls ?? []).filter((item) => item !== url) as any);
      }
    },
    [imageUrl, imageUrls, setImageUrl, setImageUrls],
  );

  const showInlineRef = isSupportImageUrl || isSupportImageUrls;
  const hasRefImages = imagePreviewUrls.length > 0;

  const maxCount = useMemo(() => {
    let count = 0;
    if (isSupportImageUrl) count += 1;
    if (isSupportImageUrls) count += imageUrlsMaxCount ?? 4;
    return count;
  }, [isSupportImageUrl, isSupportImageUrls, imageUrlsMaxCount]);

  return (
    <Flexbox gap={32} width={'100%'}>
      {showTitle && <PromptTitle />}
      <GenerationPromptInput
        disableGenerate={!isInit}
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
              maxFileSize={imageUrlsMaxFileSize ?? imageUrlMaxFileSize}
              onAdd={handleAddImage}
              onRemove={handleRemoveImage}
            />
          ) : undefined
        }
        leftActions={
          <Flexbox horizontal align={'center'} gap={4}>
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
          <PromptTransformAction mode={'image'} prompt={value} onPromptChange={setValue as any} />
        }
        onGenerate={handleGenerate}
        onValueChange={setValue}
      />
    </Flexbox>
  );
};

export default PromptInput;
