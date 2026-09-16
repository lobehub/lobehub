import { describe, expect, it } from 'vitest';

import funasrModels from './funasr';
import { LOBE_DEFAULT_MODEL_LIST } from './index';

describe('FunASR model cards', () => {
  it('exposes the documented OpenAI-compatible ASR aliases', () => {
    expect(funasrModels.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'sensevoice', type: 'asr' },
      { id: 'paraformer', type: 'asr' },
      { id: 'paraformer-en', type: 'asr' },
      { id: 'fun-asr-nano', type: 'asr' },
    ]);
  });

  it('enables SenseVoice as the portable default', () => {
    expect(funasrModels.find(({ id }) => id === 'sensevoice')?.enabled).toBe(true);
  });

  it('registers every alias in the builtin model list', () => {
    expect(
      LOBE_DEFAULT_MODEL_LIST.filter(({ providerId }) => providerId === 'funasr').map(
        ({ id }) => id,
      ),
    ).toEqual(['sensevoice', 'paraformer', 'paraformer-en', 'fun-asr-nano']);
  });
});
