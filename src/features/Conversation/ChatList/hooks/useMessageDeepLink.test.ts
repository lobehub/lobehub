import { describe, expect, it } from 'vitest';

import { parseMessageIdFromHash } from './useMessageDeepLink';

describe('parseMessageIdFromHash', () => {
  it('parses and decodes a message id', () => {
    expect(parseMessageIdFromHash('#msg_%E4%B8%AD')).toBe('msg_中');
  });

  it('returns undefined for an empty hash', () => {
    expect(parseMessageIdFromHash('')).toBeUndefined();
  });

  it('keeps a malformed encoded id usable', () => {
    expect(parseMessageIdFromHash('#msg_%')).toBe('msg_%');
  });
});
