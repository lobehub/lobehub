import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { registerLocalIconMappings } from './lobeIconMappings';
import { ModelIcon } from './modelIcon';
import { ProviderIcon } from './providerIcon';

describe('local icon mappings', () => {
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

  it('leaves models of other vendors alone', () => {
    const avatar = renderToStaticMarkup(
      createElement(ModelIcon, { model: 'speech-2.8-hd', type: 'avatar' }),
    );

    expect(avatar).not.toContain('ElevenLabs');
  });

  it('registers each mapping once however often it runs', async () => {
    const { modelMappings, providerMappings } = await import('@lobehub/icons');
    const count = () =>
      providerMappings.filter((item) => item.keywords.includes('elevenlabs')).length +
      modelMappings.filter((item) => item.keywords.includes('^eleven_')).length;

    registerLocalIconMappings();
    registerLocalIconMappings();

    expect(count()).toBe(2);
    expect(
      renderToStaticMarkup(createElement(ProviderIcon, { provider: 'elevenlabs', type: 'mono' })),
    ).toContain('<title>ElevenLabs</title>');
  });
});
