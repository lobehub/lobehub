import { describe, expect, it } from 'vitest';

import { interventionTabLabelKey, numberDuplicateLabels } from './tabLabel';

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

describe('numberDuplicateLabels', () => {
  it('numbers labels that repeat so their tabs can be told apart', () => {
    expect(numberDuplicateLabels(['Dry-run widget', 'Dry-run widget', 'Publish widget'])).toEqual([
      'Dry-run widget 1',
      'Dry-run widget 2',
      'Publish widget',
    ]);
  });

  it('leaves unique labels untouched', () => {
    expect(numberDuplicateLabels(['Search', 'Publish widget'])).toEqual([
      'Search',
      'Publish widget',
    ]);
  });
});
