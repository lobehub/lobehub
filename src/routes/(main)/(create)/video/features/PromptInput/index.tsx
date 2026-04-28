'use client';

import { ModelIcon } from '@lobehub/icons';
import { ActionIcon, Flexbox, InputNumber, Segmented, SliderWithInput, Text } from '@lobehub/ui';
import { Divider, Switch } from 'antd';
import { Clock3, Dices } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import VideoFreeQuotaInfo from '@/business/client/features/VideoFreeQuotaInfo';
import { loginRequired } from '@/components/Error/loginRequiredNotification';
import Action from '@/features/ChatInput/ActionBar/components/Action';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import PromptTransformAction from '@/features/PromptTransform/PromptTransformAction';
import { useFetchAiVideoConfig } from '@/hooks/useFetchAiVideoConfig';
import { useIsDark } from '@/hooks/useIsDark';
import { useQueryState } from '@/hooks/useQueryParam';
import {
  ConfigAction,
  GenerationMediaModeSegment,
  GenerationPromptInput,
  InlineVideoFrames,
} from '@/routes/(main)/(create)/features/GenerationInput';
import { AspectRatioSelect } from '@/routes/(main)/(create)/image/features/ConfigPanel';
import Select from '@/routes/(main)/(create)/image/features/ConfigPanel/components/Select';
import VideoModelItem from '@/routes/(main)/(create)/video/features/ConfigPanel/components/ModelSelect/VideoModelItem';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { useVideoStore } from '@/store/video';
import { createVideoSelectors, videoGenerationConfigSelectors } from '@/store/video/selectors';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';
import { generateUniqueSeeds } from '@/utils/number';

import PromptTitle from './Title';

interface PromptInputProps {
  disableAnimation?: boolean;
  showTitle?: boolean;
}

const isSupportedParamSelector = videoGenerationConfigSelectors.isSupportedParam;

const AspectRatioItem = memo(() => {
  const { value, setValue, enumValues } = useVideoGenerationConfigParam('aspectRatio');
  const options = useMemo(
    () => (enumValues ?? []).map((v) => ({ label: v, value: v })),
    [enumValues],
  );

  if (options.length === 0) return null;

  return <AspectRatioSelect options={options} value={value} onChange={(v) => setValue(v as any)} />;
});

const SizeItem = memo(() => {
  const { value, setValue, enumValues } = useVideoGenerationConfigParam('size');

  const options = useMemo(
    () =>
      enumValues?.map((size) => ({
        label: size,
        value: size,
      })) ?? [],
    [enumValues],
  );

  if (options.length === 0) return null;

  return <Select options={options} value={value} onChange={setValue} />;
});

const ResolutionItem = memo(() => {
  const { value, setValue, enumValues } = useVideoGenerationConfigParam('resolution');
  const options = useMemo(
    () => (enumValues ?? []).map((v) => ({ label: v, value: v })),
    [enumValues],
  );

  if (options.length === 0) return null;

  return (
    <Segmented
      block
      options={options}
      style={{ width: '100%' }}
      value={value}
      variant="filled"
      onChange={(v) => setValue(String(v) as any)}
    />
  );
});

const DurationItem = memo(() => {
  const { value, setValue, min, max, step, enumValues } = useVideoGenerationConfigParam('duration');

  const options = useMemo(
    () =>
      enumValues && enumValues.length > 0
        ? enumValues.map((v) => ({
            label: String(v),
            value: v,
          }))
        : [],
    [enumValues],
  );

  if (options.length > 0) {
    return (
      <Segmented
        block
        options={options}
        style={{ width: '100%' }}
        value={value ?? min}
        variant="filled"
        onChange={(v) => setValue(Number(v) as any)}
      />
    );
  }

  return (
    <SliderWithInput
      max={max}
      min={min}
      step={step ?? 1}
      value={value ?? min}
      onChange={(v) => setValue(v as any)}
    />
  );
});

const SeedItem = memo(() => {
  const { t } = useTranslation('video');
  const { value, setValue } = useVideoGenerationConfigParam('seed');

  const handleRandomize = useCallback(() => {
    setValue(generateUniqueSeeds(1)[0] as any);
  }, [setValue]);

  return (
    <Flexbox horizontal gap={4}>
      <InputNumber
        min={0}
        placeholder={t('config.seed.random')}
        step={1}
        style={{ width: '100%' }}
        value={value}
        onChange={(v) => setValue(v as any)}
      />
      <Action icon={Dices} title={t('config.seed.random')} onClick={handleRandomize} />
    </Flexbox>
  );
});

interface SwitchItemProps {
  label: string;
  paramName: 'cameraFixed' | 'generateAudio' | 'watermark' | 'webSearch';
}

const SwitchItem = memo<SwitchItemProps>(({ label, paramName }) => {
  const { value, setValue } = useVideoGenerationConfigParam(paramName);

  return (
    <Flexbox horizontal align="center" justify="space-between" padding={'0 2px'}>
      <Text weight={500}>{label}</Text>
      <Switch checked={!!value} onChange={(checked) => setValue(checked as any)} />
    </Flexbox>
  );
});

const PromptExtendItem = memo(() => {
  const { t } = useTranslation('video');
  const { value, setValue, enumValues } = useVideoGenerationConfigParam('promptExtend');

  const options = enumValues?.map((item) => ({ label: item, value: item })) ?? [];

  if (options.length > 0) {
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
  const { t } = useTranslation('video');
  const { value, setValue } = useVideoGenerationConfigParam('prompt');
  const { value: imageUrl, setValue: setImageUrl } = useVideoGenerationConfigParam('imageUrl');
  const {
    value: imageUrls,
    setValue: setImageUrls,
    maxCount: imageUrlsMaxCount,
    maxFileSize: imageUrlsMaxFileSize,
  } = useVideoGenerationConfigParam('imageUrls');
  const { maxFileSize: imageUrlMaxFileSize } = useVideoGenerationConfigParam('imageUrl');
  const { value: endImageUrl, setValue: setEndImageUrl } =
    useVideoGenerationConfigParam('endImageUrl');
  const isCreating = useVideoStore(createVideoSelectors.isCreating);
  const createVideo = useVideoStore((s) => s.createVideo);
  const setModelAndProviderOnSelect = useVideoStore((s) => s.setModelAndProviderOnSelect);
  const currentModel = useVideoStore(videoGenerationConfigSelectors.model);
  const currentProvider = useVideoStore(videoGenerationConfigSelectors.provider);
  const enabledVideoModelList = useAiInfraStore(aiProviderSelectors.enabledVideoModelList);
  const isInit = useVideoStore((s) => s.isInit);
  const isSupportImageUrl = useVideoStore(isSupportedParamSelector('imageUrl'));
  const isSupportImageUrls = useVideoStore(isSupportedParamSelector('imageUrls'));
  const isSupportEndImageUrl = useVideoStore(isSupportedParamSelector('endImageUrl'));
  const isSupportAspectRatio = useVideoStore(isSupportedParamSelector('aspectRatio'));
  const isSupportResolution = useVideoStore(isSupportedParamSelector('resolution'));
  const isSupportSize = useVideoStore(isSupportedParamSelector('size'));
  const isSupportDuration = useVideoStore(isSupportedParamSelector('duration'));
  const isSupportSeed = useVideoStore(isSupportedParamSelector('seed'));
  const isSupportGenerateAudio = useVideoStore(isSupportedParamSelector('generateAudio'));
  const isSupportPromptExtend = useVideoStore(isSupportedParamSelector('promptExtend'));
  const isSupportWatermark = useVideoStore(isSupportedParamSelector('watermark'));
  const isSupportCameraFixed = useVideoStore(isSupportedParamSelector('cameraFixed'));
  const isSupportWebSearch = useVideoStore(isSupportedParamSelector('webSearch'));
  const isLogin = useUserStore(authSelectors.isLogin);
  const { value: duration } = useVideoGenerationConfigParam('duration');
  useFetchAiVideoConfig();

  // Read query parameters
  const [promptParam, setPromptParam] = useQueryState('prompt');
  const [modelParam, setModelParam] = useQueryState('model');
  const hasProcessedPrompt = useRef(false);
  const hasProcessedModel = useRef(false);

  const handleGenerate = async () => {
    if (!isLogin) {
      loginRequired.redirect({ timeout: 2000 });
      return;
    }

    await createVideo();
  };

  useEffect(() => {
    if (modelParam && !hasProcessedModel.current && isInit) {
      const targetModel = modelParam;

      for (const providerGroup of enabledVideoModelList) {
        const found = providerGroup.children.some((m) => m.id === targetModel);
        if (found) {
          setModelAndProviderOnSelect(targetModel, providerGroup.id);
          break;
        }
      }

      hasProcessedModel.current = true;
      setModelParam(null);
    }
  }, [modelParam, isInit, enabledVideoModelList, setModelAndProviderOnSelect, setModelParam]);

  // Auto-fill and auto-send when prompt query parameter is present
  useEffect(() => {
    if (promptParam && !hasProcessedPrompt.current && isLogin) {
      const decodedPrompt = decodeURIComponent(promptParam);

      setValue(decodedPrompt);

      hasProcessedPrompt.current = true;

      setPromptParam(null);

      const timeoutId = window.setTimeout(async () => {
        await createVideo();
      }, 100);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }
  }, [promptParam, isLogin, setValue, setPromptParam, createVideo]);

  const showInlineFrames = isSupportImageUrl || isSupportImageUrls || isSupportEndImageUrl;
  const framePreviewUrls = useMemo(
    () => [imageUrl, ...(imageUrls ?? [])].filter(Boolean) as string[],
    [imageUrl, imageUrls],
  );
  const hasRefImages = framePreviewUrls.length > 0 || Boolean(endImageUrl);
  const maxCount = useMemo(() => {
    let count = 0;
    if (isSupportImageUrl) count += 1;
    if (isSupportImageUrls) count += imageUrlsMaxCount ?? 4;
    return count;
  }, [isSupportImageUrl, isSupportImageUrls, imageUrlsMaxCount]);

  const handleAddImage = useCallback(
    (data: string | { dimensions?: { height: number; width: number }; url: string }) => {
      const url = typeof data === 'string' ? data : data?.url;
      if (!url) return;
      if (framePreviewUrls.length >= maxCount) return;

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
      framePreviewUrls.length,
      maxCount,
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

  const handleEndImageChange = useCallback(
    (data: string | { dimensions?: { height: number; width: number }; url: string } | null) => {
      if (data === null) {
        setEndImageUrl(null as any);
        return;
      }
      const url = typeof data === 'string' ? data : data?.url;
      setEndImageUrl((url ?? null) as any);
    },
    [setEndImageUrl],
  );

  return (
    <Flexbox gap={32} width={'100%'}>
      {showTitle && <PromptTitle />}
      <Flexbox gap={8}>
        <GenerationPromptInput
          disableGenerate={!isInit}
          generateLabel={t('generation.actions.generate')}
          generatingLabel={t('generation.status.generating')}
          isCreating={isCreating}
          isDarkMode={isDarkMode}
          value={value}
          inlineContent={
            showInlineFrames ? (
              <InlineVideoFrames
                endImageUrl={endImageUrl}
                imageUrl={imageUrl}
                imageUrls={imageUrls}
                isSupportEndImage={isSupportEndImageUrl}
                maxCount={maxCount}
                maxFileSize={imageUrlsMaxFileSize ?? imageUrlMaxFileSize}
                onEndImageChange={handleEndImageChange}
                onImageUrlsChange={handleAddImage}
                onRemoveImageUrl={handleRemoveImage}
                onImageChange={(data) => {
                  if (data === null) {
                    handleRemoveImage(imageUrl || '');
                    return;
                  }
                  handleAddImage(data);
                }}
              />
            ) : undefined
          }
          leftActions={
            <Flexbox horizontal align={'center'} gap={4}>
              <GenerationMediaModeSegment mode={'video'} />
              <ModelSwitchPanel
                ModelItemComponent={VideoModelItem}
                enabledList={enabledVideoModelList}
                model={currentModel ?? undefined}
                openOnHover={false}
                placement="topLeft"
                pricingMode="video"
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
                    {isSupportAspectRatio && (
                      <Flexbox gap={6}>
                        <Text fontSize={12}>{t('config.aspectRatio.label')}</Text>
                        <AspectRatioItem />
                      </Flexbox>
                    )}
                    {isSupportResolution && (
                      <Flexbox gap={6}>
                        <Text fontSize={12}>{t('config.resolution.label')}</Text>
                        <ResolutionItem />
                      </Flexbox>
                    )}
                    {isSupportSize && (
                      <Flexbox gap={6}>
                        <Text fontSize={12}>{t('config.size.label')}</Text>
                        <SizeItem />
                      </Flexbox>
                    )}
                    {isSupportSeed && (
                      <Flexbox gap={6}>
                        <Text fontSize={12}>{t('config.seed.label')}</Text>
                        <SeedItem />
                      </Flexbox>
                    )}
                    {(isSupportGenerateAudio ||
                      isSupportCameraFixed ||
                      isSupportWatermark ||
                      isSupportPromptExtend ||
                      isSupportWebSearch) && <Divider style={{ marginBlock: 4 }} />}
                    {isSupportGenerateAudio && (
                      <SwitchItem
                        label={t('config.generateAudio.label')}
                        paramName={'generateAudio'}
                      />
                    )}
                    {isSupportCameraFixed && (
                      <SwitchItem label={t('config.cameraFixed.label')} paramName={'cameraFixed'} />
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
              {isSupportDuration && (
                <Action
                  icon={Clock3}
                  trigger={'click'}
                  popover={{
                    content: <DurationItem />,
                    minWidth: 220,
                    title: t('config.duration.label'),
                  }}
                  title={[t('config.duration.label'), duration ? `${duration}s` : '']
                    .filter(Boolean)
                    .join(' ')}
                />
              )}
            </Flexbox>
          }
          placeholder={
            hasRefImages ? t('config.prompt.placeholderWithRef') : t('config.prompt.placeholder')
          }
          rightActions={
            <PromptTransformAction mode={'video'} prompt={value} onPromptChange={setValue as any} />
          }
          onGenerate={handleGenerate}
          onValueChange={setValue}
        />
        <VideoFreeQuotaInfo />
      </Flexbox>
    </Flexbox>
  );
};

export default PromptInput;
