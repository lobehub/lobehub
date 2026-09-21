import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProviderCombine, ProviderIcon } from './providerIcon';

describe('provider artwork', () => {
  it.each(['unsloth', 'Unsloth'])('renders the official %s avatar and wordmark', (provider) => {
    const avatar = renderToStaticMarkup(createElement(ProviderIcon, { provider, type: 'avatar' }));
    const wordmark = renderToStaticMarkup(createElement(ProviderCombine, { provider }));

    expect(avatar).toContain('<title>Unsloth</title>');
    expect(avatar).not.toContain('lucide-provider');
    expect(wordmark).toContain('<title>Unsloth</title>');
    expect(wordmark).not.toContain('lucide-provider');
    expect((wordmark.match(/<svg /g) || []).length).toBe(2);
  });
});
