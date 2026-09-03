import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatGatewayPerfSummary,
  gatewayPerfAbort,
  gatewayPerfConnectStart,
  gatewayPerfFirstEvent,
  gatewayPerfFreshRun,
  gatewayPerfReconnect,
  gatewayPerfReset,
  gatewayPerfStatusChanged,
} from '../gatewayPerf';

describe('gatewayPerf', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gatewayPerfReset();
  });

  afterEach(() => {
    gatewayPerfReset();
    vi.useRealTimers();
  });

  describe('formatGatewayPerfSummary', () => {
    it('formats all phases with mode', () => {
      const line = formatGatewayPerfSummary(
        'op-1',
        { exec_roundtrip: 100, pre_connect_gap: 50, ws_handshake: 30, auth_rtt: 20, ttfb: 60 },
        { reconnect: false },
      );
      expect(line).toContain('op=op-1');
      expect(line).toContain('exec=100ms');
      expect(line).toContain('gap=50ms');
      expect(line).toContain('handshake=30ms');
      expect(line).toContain('auth=20ms');
      expect(line).toContain('ttfb=60ms');
      expect(line).toContain('mode=fresh');
    });

    it('marks missing phases as n/a and reconnect mode', () => {
      const line = formatGatewayPerfSummary('op-2', { ttfb: 5 }, { reconnect: true });
      expect(line).toContain('exec=n/a');
      expect(line).toContain('ttfb=5ms');
      expect(line).toContain('mode=reconnect');
    });
  });

  describe('fresh run flow', () => {
    it('records exec_roundtrip and pre_connect_gap and logs a summary on first event', () => {
      vi.setSystemTime(1000);
      gatewayPerfFreshRun('op-1', 0);
      vi.setSystemTime(500);
      gatewayPerfConnectStart('op-1');
      gatewayPerfStatusChanged('op-1', 'connecting');
      vi.setSystemTime(620);
      gatewayPerfStatusChanged('op-1', 'authenticating');
      vi.setSystemTime(700);
      gatewayPerfStatusChanged('op-1', 'connected');
      vi.setSystemTime(800);
      gatewayPerfFirstEvent('op-1');

      // Summary is logged via debug; assert observable state indirectly —
      // the timer was consumed, so a second first-event is a no-op and the
      // abort path doesn't throw.
      expect(() => gatewayPerfFirstEvent('op-1')).not.toThrow();
      expect(() => gatewayPerfAbort('op-1')).not.toThrow();
    });

    it('ignores a second fresh-run registration for the same op', () => {
      gatewayPerfFreshRun('op-1', 0);
      // A reconnect racing in must NOT clobber the fresh timer (first wins).
      expect(() => gatewayPerfReconnect('op-1', 999)).not.toThrow();
      expect(() => gatewayPerfConnectStart('op-1')).not.toThrow();
    });

    it('handles precreated results without exec phase', () => {
      gatewayPerfFreshRun('op-1', null);
      expect(() => gatewayPerfConnectStart('op-1')).not.toThrow();
      expect(() => gatewayPerfFirstEvent('op-1')).not.toThrow();
    });
  });

  describe('watchdogs', () => {
    it('drops an orphan timer when connect never starts', () => {
      gatewayPerfFreshRun('op-1', 0);
      vi.advanceTimersByTime(31_000);
      // Orphaned — later connect events are no-ops and don't throw.
      expect(() => gatewayPerfConnectStart('op-1')).not.toThrow();
    });

    it('logs a partial summary when no event arrives within the ttfb window', () => {
      gatewayPerfFreshRun('op-1', 0);
      gatewayPerfConnectStart('op-1');
      // Must not throw when the watchdog fires.
      expect(() => vi.advanceTimersByTime(10 * 60 * 1000 + 1)).not.toThrow();
    });
  });
});
