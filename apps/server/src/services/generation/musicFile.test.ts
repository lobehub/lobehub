import { describe, expect, it } from 'vitest';

import { buildMusicGenerationFilePayload } from './musicFile';

describe('buildMusicGenerationFilePayload', () => {
  it('names the file after the title and keeps the storage path for dedup', () => {
    const payload = buildMusicGenerationFilePayload({
      generationId: 'gen-1',
      processResult: {
        audioKey: 'generations/music/abc_audio.wav',
        duration: 90,
        fileHash: 'hash',
        fileSize: 42,
        mimeType: 'audio/wav',
      },
      prompt: 'rainy night',
      title: 'Rain/Night',
    });

    expect(payload).toMatchObject({
      fileHash: 'hash',
      fileType: 'audio/wav',
      metadata: {
        dirname: 'generations/music',
        duration: 90,
        generationId: 'gen-1',
        path: 'generations/music/abc_audio.wav',
      },
      name: 'Rain_Night.wav',
      size: 42,
      url: 'generations/music/abc_audio.wav',
    });
  });

  it('falls back to the generation id without title or prompt', () => {
    const payload = buildMusicGenerationFilePayload({
      generationId: 'gen-2',
      processResult: {
        audioKey: 'generations/music/x_audio.mp3',
        fileHash: 'h',
        fileSize: 1,
        mimeType: 'audio/mpeg',
      },
    });
    expect(payload.name).toBe('gen-2.mp3');
  });
});
