import { describe, expect, it } from 'vitest';

import {
  isServerDefaultHeterogeneousReportedModel,
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

describe('isServerDefaultHeterogeneousReportedModel', () => {
  it('recognizes server-default runs from the reported model alone', () => {
    expect(isServerDefaultHeterogeneousReportedModel('lobehub/claude-sonnet-4-6')).toBe(true);
    expect(isServerDefaultHeterogeneousReportedModel('lobehub-default')).toBe(true);
    expect(isServerDefaultHeterogeneousReportedModel('custom:LobeHub-Server-Default-0')).toBe(true);
  });

  it('rejects models the user ran with their own key', () => {
    expect(isServerDefaultHeterogeneousReportedModel('claude-opus-4-6')).toBe(false);
    expect(isServerDefaultHeterogeneousReportedModel(undefined)).toBe(false);
  });
});
