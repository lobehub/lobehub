import { type RuntimeImageGenParams, type RuntimeImageGenParamsKeys } from 'model-bank';
import { DEFAULT_ASPECT_RATIO, PRESET_ASPECT_RATIOS } from 'model-bank';
import { useCallback, useMemo } from 'react';

import { useImageStore } from '../../store';
import { imageGenerationConfigSelectors } from './selectors';

export function useGenerationConfigParam<
  N extends RuntimeImageGenParamsKeys,
  V extends RuntimeImageGenParams[N],
>(paramName: N) {
  const parameters = useImageStore(imageGenerationConfigSelectors.parameters);
  const parametersSchema = useImageStore(imageGenerationConfigSelectors.parametersSchema);

  const paramValue = parameters?.[paramName] as V;
  const setParamsValue = useImageStore((s) => s.setParamOnInput<N>);
  const setValue = useCallback(
    (value: V) => {
      setParamsValue(paramName, value);
    },
    [paramName, setParamsValue],
  );

  const paramConfig = parametersSchema?.[paramName];
  const paramConstraints = useMemo(() => {
    const min =
      paramConfig && typeof paramConfig === 'object' && 'min' in paramConfig
        ? paramConfig.min
        : undefined;
    const max =
      paramConfig && typeof paramConfig === 'object' && 'max' in paramConfig
        ? paramConfig.max
        : undefined;
    const step =
      paramConfig && typeof paramConfig === 'object' && 'step' in paramConfig
        ? paramConfig.step
        : undefined;
    const description =
      paramConfig && typeof paramConfig === 'object' && 'description' in paramConfig
        ? paramConfig.description
        : undefined;
    const enumValues =
      paramConfig && typeof paramConfig === 'object' && 'enum' in paramConfig
        ? paramConfig.enum
        : undefined;
    const maxFileSize =
      paramConfig && typeof paramConfig === 'object' && 'maxFileSize' in paramConfig
        ? paramConfig.maxFileSize
        : undefined;
    const maxCount =
      paramConfig && typeof paramConfig === 'object' && 'maxCount' in paramConfig
        ? paramConfig.maxCount
        : undefined;

    return {
      description,
      max,
      min,
      step,
      enumValues,
      maxFileSize,
      maxCount,
    };
  }, [paramConfig]);

  return {
    value: paramValue as V,
    setValue,
    ...paramConstraints,
  };
}

export function useDimensionControl() {
  const store = useImageStore();
  const paramsSchema = useImageStore(imageGenerationConfigSelectors.parametersSchema);

  const modelAspectRatio = useImageStore((s) => s.parameters?.aspectRatio);
  const currentAspectRatio = store.activeAspectRatio ?? modelAspectRatio ?? DEFAULT_ASPECT_RATIO;

  const isSupportWidth = useImageStore(imageGenerationConfigSelectors.isSupportedParam('width'));
  const isSupportHeight = useImageStore(imageGenerationConfigSelectors.isSupportedParam('height'));
  const isSupportAspectRatio = useImageStore(
    imageGenerationConfigSelectors.isSupportedParam('aspectRatio'),
  );

  const aspectRatioOptions = useMemo(() => {
    const modelOptions = paramsSchema?.aspectRatio?.enum || [];

    // If the schema has aspectRatio and it's not empty, use the options from the schema directly
    if (modelOptions.length > 0) {
      return modelOptions;
    }

    // Otherwise, use preset options
    return PRESET_ASPECT_RATIOS;
  }, [paramsSchema]);

  // As long as not all dimension-related controls are hidden, this container should be displayed
  const showDimensionControl = isSupportAspectRatio || isSupportWidth || isSupportHeight;

  return {
    isLocked: store.isAspectRatioLocked,
    toggleLock: store.toggleAspectRatioLock,

    width: store.parameters?.width,
    height: store.parameters?.height,
    aspectRatio: currentAspectRatio,

    setWidth: store.setWidth,
    setHeight: store.setHeight,
    setAspectRatio: store.setAspectRatio,

    widthSchema: paramsSchema?.width,
    heightSchema: paramsSchema?.height,

    options: aspectRatioOptions,

    showDimensionControl,
  };
}
