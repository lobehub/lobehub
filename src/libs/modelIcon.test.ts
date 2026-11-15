import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ModelIcon } from './modelIcon';

describe('TTS model icons', () => {
  it.each(['eleven_v4', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'])(
    'renders the ElevenLabs avatar for the %s model',
    (model) => {
      const avatar = renderToStaticMarkup(createElement(ModelIcon, { model, type: 'avatar' }));

      expect(avatar).toContain('<title>ElevenLabs</title>');
    },
  );

  it.each(['s2.1-pro', 's2-pro', 'drama-3', 's1'])(
    'renders the Fish Audio avatar for the %s model',
    (model) => {
      const avatar = renderToStaticMarkup(createElement(ModelIcon, { model, type: 'avatar' }));

      expect(avatar).toContain('<title>FishAudio</title>');
    },
  );

  it.each(['seed-tts-2.0', 'seed-icl-2.0'])(
    'renders the Doubao avatar for %s instead of the OpenAI tts- mark',
    (model) => {
      const avatar = renderToStaticMarkup(createElement(ModelIcon, { model, type: 'avatar' }));

      expect(avatar).toContain('<title>Doubao</title>');
    },
  );

  it('keeps the OpenAI mark for OpenAI tts models', () => {
    const avatar = renderToStaticMarkup(
      createElement(ModelIcon, { model: 'tts-1', type: 'avatar' }),
    );

    expect(avatar).not.toContain('Doubao');
  });

  it('leaves models of other vendors alone', () => {
    const avatar = renderToStaticMarkup(
      createElement(ModelIcon, { model: 'speech-2.8-hd', type: 'avatar' }),
    );

    expect(avatar).not.toContain('ElevenLabs');
  });
});
