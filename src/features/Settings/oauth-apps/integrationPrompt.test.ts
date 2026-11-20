import { describe, expect, it } from 'vitest';

import auth from '../../../../packages/locales/src/default/auth';
import { getIntegrationEndpoints } from './integrationEndpoints';
import { integrationPromptKey, integrationPromptValues } from './integrationPrompt';

const placeholders = (template: string) =>
  [...template.matchAll(/\{\{(\w+)\}\}/g)].map(([, name]) => name);

describe('integration prompt', () => {
  it.each(['web', 'native'])('fills every placeholder of the %s template', (type) => {
    const template = auth[integrationPromptKey(type)];
    const values = integrationPromptValues(
      getIntegrationEndpoints('https://app.lobehub.com/oidc', type),
      { clientId: 'lca_test', name: 'My App' },
    );

    expect(placeholders(template).length).toBeGreaterThan(0);
    for (const name of placeholders(template))
      expect(values[name as keyof typeof values]).toBeTruthy();
  });

  it('picks the flow by app type', () => {
    expect(integrationPromptKey('web')).toBe('oauthApp.integration.prompt.web');
    expect(integrationPromptKey('native')).toBe('oauthApp.integration.prompt.device');
  });
});
