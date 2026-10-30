import { describe, expect, it } from 'vitest';

import { interventionTabLabelKey } from './tabLabel';

describe('interventionTabLabelKey', () => {
  it('names builtin calls by their localized action, not the raw API name', () => {
    expect(interventionTabLabelKey({ apiName: 'dryRunWidget', identifier: 'lobe-dashboard' })).toBe(
      'builtins.lobe-dashboard.apiName.dryRunWidget',
    );
    expect(
      interventionTabLabelKey({ apiName: 'requestPublish', identifier: 'lobe-dashboard' }),
    ).toBe('builtins.lobe-dashboard.apiName.requestPublish');
  });

  it('keeps the API name for tools that are not builtin', () => {
    expect(interventionTabLabelKey({ apiName: 'fetchThing', identifier: 'some-mcp' })).toBe(
      undefined,
    );
  });
});
