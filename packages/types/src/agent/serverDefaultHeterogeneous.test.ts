import { describe, expect, it } from 'vitest';

import { unwrapServerDefaultHeterogeneousModel } from './serverDefaultHeterogeneous';

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
