import { describe, expect, it } from 'vitest';

import {
  formatServerDefaultHeterogeneousModel,
  unwrapServerDefaultHeterogeneousModel,
} from './serverDefaultHeterogeneous';

describe('Droid server-default model reports', () => {
  it('maps Droid custom model reports to the selected catalog model', () => {
    expect(
      unwrapServerDefaultHeterogeneousModel('custom:LobeHub-Server-Default-0', 'gpt-5.4'),
    ).toBe('gpt-5.4');
    expect(unwrapServerDefaultHeterogeneousModel('custom:LobeHub-Server-Default-0')).toBe(
      'custom:LobeHub-Server-Default-0',
    );
  });
});

describe('Copilot server-default model reports', () => {
  it('maps the request model Copilot selects over ACP back to the catalog model', () => {
    const reported = formatServerDefaultHeterogeneousModel('claude-sonnet-4-6');
    expect(reported).toBe('lobehub/claude-sonnet-4-6');
    expect(unwrapServerDefaultHeterogeneousModel(reported, 'claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6',
    );
  });
});
