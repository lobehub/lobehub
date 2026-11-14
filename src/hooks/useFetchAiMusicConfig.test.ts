import { describe, expect, it } from 'vitest';

import { resolveInitialMusicModel } from './useFetchAiMusicConfig';

const list = [
  { children: [{ id: 'song-model-lite' }], id: 'acme', name: 'Acme' },
  { children: [{ id: 'song-model' }, { id: 'song-model-mini' }], id: 'fal', name: 'fal' },
] as any;

describe('resolveInitialMusicModel', () => {
  it('prefers the last selected model while it is enabled', () => {
    expect(resolveInitialMusicModel(list, 'song-model-mini', 'fal')).toEqual({
      model: 'song-model-mini',
      provider: 'fal',
    });
  });

  it('falls back to the first enabled music model', () => {
    expect(resolveInitialMusicModel(list, 'gone', 'fal')).toEqual({
      model: 'song-model-lite',
      provider: 'acme',
    });
    expect(resolveInitialMusicModel([list[0]])).toEqual({
      model: 'song-model-lite',
      provider: 'acme',
    });
  });

  it('returns nothing when no music model is enabled', () => {
    expect(resolveInitialMusicModel([])).toEqual({});
  });
});
