import { describe, expect, it } from 'vitest';

import { getTextDirectionFromFirstStrong } from './getTextDirectionFromFirstStrong';

describe('getTextDirectionFromFirstStrong (ChatInput re-export)', () => {
  it('still resolves rtl for Persian via the shared util', () => {
    expect(getTextDirectionFromFirstStrong('سلام')).toBe('rtl');
  });
});
