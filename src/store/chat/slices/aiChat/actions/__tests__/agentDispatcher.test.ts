import { describe, expect, it } from 'vitest';

import { selectRuntimeType } from '../agentDispatcher';

const heteroProvider = { command: 'claude', type: 'claude-code' as const };

describe('selectRuntimeType', () => {
  describe('on web (isDesktop = false)', () => {
    const opts = { isDesktop: false };

    it('returns client when no signal is set', () => {
      expect(selectRuntimeType({ isGatewayMode: false }, opts)).toBe('client');
    });

    it('returns gateway when gateway mode is enabled', () => {
      expect(selectRuntimeType({ isGatewayMode: true }, opts)).toBe('gateway');
    });

    it('ignores heterogeneousProvider on web — falls through to gateway/client', () => {
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: true }, opts),
      ).toBe('gateway');
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: false }, opts),
      ).toBe('client');
    });
  });

  describe('on desktop (isDesktop = true)', () => {
    const opts = { isDesktop: true };

    it('returns hetero when a heterogeneousProvider is configured', () => {
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: true }, opts),
      ).toBe('hetero');
      expect(
        selectRuntimeType({ heterogeneousProvider: heteroProvider, isGatewayMode: false }, opts),
      ).toBe('hetero');
    });

    it('falls back to gateway/client when no hetero provider', () => {
      expect(selectRuntimeType({ isGatewayMode: true }, opts)).toBe('gateway');
      expect(selectRuntimeType({ isGatewayMode: false }, opts)).toBe('client');
    });
  });

  describe('parentRuntime override', () => {
    it('parentRuntime wins over every other signal', () => {
      expect(
        selectRuntimeType(
          {
            parentRuntime: 'client',
            heterogeneousProvider: heteroProvider,
            isGatewayMode: true,
          },
          { isDesktop: true },
        ),
      ).toBe('client');

      expect(
        selectRuntimeType({ parentRuntime: 'gateway', isGatewayMode: false }, { isDesktop: false }),
      ).toBe('gateway');

      expect(
        selectRuntimeType({ parentRuntime: 'hetero', isGatewayMode: true }, { isDesktop: false }),
      ).toBe('hetero');
    });
  });
});
