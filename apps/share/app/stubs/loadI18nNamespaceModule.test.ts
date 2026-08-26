import { describe, expect, it } from 'vitest';

import { loadI18nNamespaceModule } from './loadI18nNamespaceModule';

describe('loadI18nNamespaceModule', () => {
  it('bundles the agent namespace required by standalone agent-share SSR', async () => {
    const module = await loadI18nNamespaceModule({
      defaultLang: 'en-US',
      lng: 'en-US',
      normalizeLocale: (locale) => locale ?? 'en-US',
      ns: 'agent',
    });

    // A visitor-surface key: the standalone share SSR renders the visitor
    // conversation UI, so the bundled agent namespace must carry these.
    expect(module.default).toHaveProperty('share.visitor.input.placeholder');
  });
});
