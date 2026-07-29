// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getCurrentOrgRole, isPlatformAdmin } from './index';

describe('orgAccess stubs', () => {
  describe('getCurrentOrgRole', () => {
    it('returns null until org membership tables exist', async () => {
      await expect(getCurrentOrgRole('user-1', 'org-1')).resolves.toBeNull();
    });
  });

  describe('isPlatformAdmin', () => {
    it('returns false until the platform admin table exists', async () => {
      await expect(isPlatformAdmin('user-1')).resolves.toBe(false);
    });
  });
});
