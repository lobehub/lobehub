import { type RuntimeMusicGenParams, type RuntimeMusicGenParamsKeys } from 'model-bank';
import { useCallback } from 'react';

import { useMusicStore } from '../../store';
import { musicGenerationConfigSelectors } from './selectors';

/** Read and write one music param of the draft, plus its schema entry for constraints */
export function useMusicGenerationConfigParam<N extends RuntimeMusicGenParamsKeys>(paramName: N) {
  const value = useMusicStore((s) => musicGenerationConfigSelectors.parameters(s)?.[paramName]);
  const schema = useMusicStore(
    (s) => musicGenerationConfigSelectors.parametersSchema(s)?.[paramName],
  );
  const setParamOnInput = useMusicStore((s) => s.setParamOnInput);

  const setValue = useCallback(
    (next: RuntimeMusicGenParams[N]) => setParamOnInput(paramName, next),
    [paramName, setParamOnInput],
  );

  return { schema, setValue, value: value as RuntimeMusicGenParams[N] };
}
