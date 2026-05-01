import { describe, expect, it, vi } from 'vitest';

import { MarketApiService } from './marketApi';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {},
}));

vi.mock('@/services/discover', () => ({
  discoverService: { safeInjectMPToken: vi.fn() },
}));

describe('MarketApiService', () => {
  describe('getSkillDownloadUrl', () => {
    it('uses the hosted Market proxy path by default', () => {
      const service = new MarketApiService();

      expect(service.getSkillDownloadUrl('skill.alpha')).toBe(
        '/market-api/api/v1/skills/skill.alpha/download',
      );
    });
  });
});
