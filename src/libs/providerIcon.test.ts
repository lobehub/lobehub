import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProviderCombine, ProviderIcon } from './providerIcon';

describe('provider artwork', () => {
  it.each([
    { provider: 'unsloth', title: 'Unsloth' },
    { provider: 'Unsloth', title: 'Unsloth' },
    { provider: 'typesafe', title: 'TypeSafe AI' },
    { provider: 'TypeSafe', title: 'TypeSafe AI' },
  ])('renders the official $provider avatar and wordmark', ({ provider, title }) => {
    const avatar = renderToStaticMarkup(createElement(ProviderIcon, { provider, type: 'avatar' }));
    const wordmark = renderToStaticMarkup(createElement(ProviderCombine, { provider }));

    expect(avatar).toContain(`<title>${title}</title>`);
    expect(avatar).not.toContain('lucide-provider');
    expect(wordmark).toContain(`<title>${title}</title>`);
    expect(wordmark).not.toContain('lucide-provider');
    expect((wordmark.match(/<svg /g) || []).length).toBe(2);
  });

  // Mapped locally until @lobehub/icons maps the id (see ./lobeIconMappings).
  it.each(['elevenlabs', 'ElevenLabs'])(
    'renders the official %s avatar and wordmark',
    (provider) => {
      const avatar = renderToStaticMarkup(
        createElement(ProviderIcon, { provider, type: 'avatar' }),
      );
      const wordmark = renderToStaticMarkup(createElement(ProviderCombine, { provider }));

      expect(avatar).toContain('<title>ElevenLabs</title>');
      expect(avatar).not.toContain('lucide-provider');
      // The brand's combined artwork is the wordmark alone.
      expect(wordmark).toContain('<title>ElevenLabs</title>');
      expect(wordmark).not.toContain('lucide-provider');
    },
  );
});
