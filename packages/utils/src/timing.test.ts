import { describe, expect, it, vi } from 'vitest';

import {
  createTimingHelpers,
  formatDuration,
  formatElapsedClockTime,
  markTimingSinkStageDone,
  markTimingStageDone,
  type TimingLogger,
  type TimingSink,
} from './timing';

describe('timing utilities', () => {
  const context = { requestId: 'req-1', startedAt: Date.now() };

  describe('formatElapsedClockTime', () => {
    it('formats elapsed milliseconds as mm:ss below one hour', () => {
      expect(formatElapsedClockTime(0)).toBe('00:00');
      expect(formatElapsedClockTime(33_000)).toBe('00:33');
      expect(formatElapsedClockTime(65_000)).toBe('01:05');
    });

    it('formats elapsed milliseconds as h:mm:ss at one hour or above', () => {
      expect(formatElapsedClockTime(3_661_000)).toBe('1:01:01');
    });

    it('prefixes days once elapsed time passes 24 hours', () => {
      expect(formatElapsedClockTime(86_400_000 + 3_661_000)).toBe('1d 01:01:01');
    });

    it('clamps negative elapsed time to zero', () => {
      expect(formatElapsedClockTime(-1_000)).toBe('00:00');
    });
  });

  describe('formatDuration', () => {
    const s = 1000;
    const m = 60 * s;
    const h = 60 * m;
    const d = 24 * h;

    it('shows seconds below one hour and drops them above it', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(42 * s)).toBe('42s');
      expect(formatDuration(3 * m + 7 * s)).toBe('3m 7s');
      expect(formatDuration(23 * h + 59 * m + 59 * s)).toBe('23h 59m');
    });

    it('rolls hours over into days past 24 hours', () => {
      expect(formatDuration(d)).toBe('1d 0h 0m');
      expect(formatDuration(d + 21 * h + 23 * m)).toBe('1d 21h 23m');
      expect(formatDuration(221 * h + 29 * m)).toBe('9d 5h 29m');
    });

    it('honours an explicit smallest unit', () => {
      expect(formatDuration(30 * s, { minUnit: 'm' })).toBe('0m');
      expect(formatDuration(h + 2 * m + 3 * s, { minUnit: 's' })).toBe('1h 2m 3s');
      expect(formatDuration(d + 2 * m, { minUnit: 's' })).toBe('1d 0h 2m 0s');
    });

    it('pads trailing units when asked', () => {
      expect(formatDuration(3 * m + 5 * s, { pad: true })).toBe('3m 05s');
      expect(formatDuration(d + 5 * h + 4 * m, { pad: true })).toBe('1d 05h 04m');
    });

    it('trims zero trailing units when asked', () => {
      expect(formatDuration(3 * m, { trimZero: true })).toBe('3m');
      expect(formatDuration(h, { trimZero: true })).toBe('1h');
      expect(formatDuration(d + 3 * h, { trimZero: true })).toBe('1d 3h');
      expect(formatDuration(d + 3 * m, { trimZero: true })).toBe('1d 0h 3m');
    });

    it('clamps negative durations to zero', () => {
      expect(formatDuration(-5 * s)).toBe('0s');
    });
  });

  describe('markTimingStageDone', () => {
    it('should emit a done marker with zero stage duration', () => {
      const logger = vi.fn<TimingLogger>();

      markTimingStageDone(logger, context, 'lambda.aiChat.messagesAndTopics.fastResponse', {
        messageCount: 2,
        reason: 'simple-existing-topic-turn',
      });

      expect(logger).toHaveBeenCalledWith(
        '[%s] %s totalMs=%d %O',
        'req-1',
        'lambda.aiChat.messagesAndTopics.fastResponse:done',
        expect.any(Number),
        {
          messageCount: 2,
          reason: 'simple-existing-topic-turn',
          stageMs: 0,
        },
      );
    });

    it('should skip logging without timing context', () => {
      const logger = vi.fn<TimingLogger>();

      markTimingStageDone(logger, undefined, 'lambda.aiChat.messagesAndTopics.fastResponse');

      expect(logger).not.toHaveBeenCalled();
    });
  });

  describe('markTimingSinkStageDone', () => {
    it('should emit a done marker through a timing sink', () => {
      const timing = { log: vi.fn<TimingSink['log']>() };

      markTimingSinkStageDone(timing, 'db.message.query.cacheHit', { rowCount: 2 });

      expect(timing.log).toHaveBeenCalledWith('db.message.query.cacheHit:done', {
        rowCount: 2,
        stageMs: 0,
      });
    });
  });

  describe('createTimingHelpers', () => {
    it('should expose markStageDone on the helper facade', () => {
      const helpers = createTimingHelpers('lobe-server:test');

      expect(helpers.markStageDone).toBeTypeOf('function');
    });
  });
});
