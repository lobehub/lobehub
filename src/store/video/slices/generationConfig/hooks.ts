import { type RuntimeVideoGenParams, type RuntimeVideoGenParamsKeys } from 'model-bank';
import { useCallback, useMemo } from 'react';

import { useVideoStore } from '../../store';
import { videoGenerationConfigSelectors } from './selectors';

export function useVideoGenerationConfigParam<
  N extends RuntimeVideoGenParamsKeys,
  V extends RuntimeVideoGenParams[N],
>(paramName: N) {
  const parameters = useVideoStore(videoGenerationConfigSelectors.parameters);
  const parametersSchema = useVideoStore(videoGenerationConfigSelectors.parametersSchema);

  const paramValue = parameters?.[paramName] as V;
  const setParamsValue = useVideoStore((s) => s.setParamOnInput<N>);
  const setValue = useCallback(
    (value: V) => {
      setParamsValue(paramName, value);
    },
    [paramName, setParamsValue],
  );

  const paramConfig = parametersSchema?.[paramName];
  const paramConstraints = useMemo(() => {
    if (!paramConfig || typeof paramConfig !== 'object') return {};

    const maxFileSize = 'maxFileSize' in paramConfig ? paramConfig.maxFileSize : undefined;
    const enumValues = 'enum' in paramConfig ? (paramConfig.enum as string[]) : undefined;
    const min = 'min' in paramConfig ? (paramConfig.min as number) : undefined;
    const max = 'max' in paramConfig ? (paramConfig.max as number) : undefined;
    const step = 'step' in paramConfig ? (paramConfig.step as number) : undefined;

    return { enumValues, max, maxFileSize, min, step };
  }, [paramConfig]);

  return {
    setValue,
    value: paramValue as V,
    ...paramConstraints,
  };
}
