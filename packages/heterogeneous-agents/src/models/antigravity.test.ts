import { describe, expect, it } from 'vitest';

import { parseAntigravityModelCatalog } from './antigravity';

describe('parseAntigravityModelCatalog', () => {
  it('preserves native model slugs and labels without inferring a provider', () => {
    expect(
      parseAntigravityModelCatalog(
        [
          'Fetching available models...',
          'MODEL  NAME',
          '\u001B[32mgemini-4-argon-high\u001B[0m       Gemini 4 Argon (High)',
          'claude-sonnet-4-5  Claude Sonnet 4.5',
          'gemini-4-argon-high  Duplicate',
          '',
          'some diagnostic message',
        ].join('\r\n'),
      ),
    ).toEqual([
      {
        id: 'gemini-4-argon-high',
        label: 'Gemini 4 Argon (High)',
        modelId: 'gemini-4-argon-high',
        providerId: 'antigravity',
      },
      {
        id: 'claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5',
        modelId: 'claude-sonnet-4-5',
        providerId: 'antigravity',
      },
    ]);
  });

  it('ignores empty output, errors, headers and truncated ids', () => {
    expect(parseAntigravityModelCatalog('')).toEqual([]);
    expect(
      parseAntigravityModelCatalog(
        'MODEL ID  DISPLAY NAME\nError:  authentication required\nmodel…  Truncated',
      ),
    ).toEqual([]);
  });
});
