import { describe, expect, it } from 'vitest';

import {
  hashOperatorPassword,
  meetsOperatorPasswordComplexity,
  unusablePasswordHash,
  verifyOperatorPassword,
} from '../operatorPassword';

describe('operatorPassword', () => {
  it('hashes and verifies scrypt passwords', async () => {
    const hash = await hashOperatorPassword('Secret9x');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(await verifyOperatorPassword('Secret9x', hash)).toBe(true);
    expect(await verifyOperatorPassword('wrong-pass', hash)).toBe(false);
  });

  it('rejects unusable migrated hashes and chat-style empty hashes', async () => {
    expect(await verifyOperatorPassword('anything1', unusablePasswordHash('padm_1'))).toBe(false);
    expect(await verifyOperatorPassword('anything1', '')).toBe(false);
  });

  it('enforces letter + digit complexity', () => {
    expect(meetsOperatorPasswordComplexity('short')).toBe(false);
    expect(meetsOperatorPasswordComplexity('longpassword')).toBe(false);
    expect(meetsOperatorPasswordComplexity('Operator1')).toBe(true);
  });
});
