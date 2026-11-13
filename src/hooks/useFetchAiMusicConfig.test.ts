import { describe, expect, it } from 'vitest';

import { resolveInitialMusicModel } from './useFetchAiMusicConfig';

const list = [
  { children: [{ id: 'music-2.6' }], id: 'minimax', name: 'MiniMax' },
  { children: [{ id: 'suno-v6' }, { id: 'suno-v6-mini' }], id: 'suno', name: 'Suno' },
] as any;

describe('resolveInitialMusicModel', () => {
  it('prefers the last selected model while it is enabled', () => {
    expect(resolveInitialMusicModel(list, 'suno-v6-mini', 'suno')).toEqual({
      model: 'suno-v6-mini',
      provider: 'suno',
    });
  });

  it('falls back to the default Suno model', () => {
    expect(resolveInitialMusicModel(list, 'gone', 'suno')).toEqual({
      model: 'suno-v6',
      provider: 'suno',
    });
  });

  it('falls back to the first enabled music model', () => {
    expect(resolveInitialMusicModel([list[0]])).toEqual({
      model: 'music-2.6',
      provider: 'minimax',
    });
  });

  it('returns nothing when no music model is enabled', () => {
    expect(resolveInitialMusicModel([])).toEqual({});
  });
});
