import { describe, expect, it, vi } from 'vitest';

import {
  createTimingHelpers,
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

    it('clamps negative elapsed time to zero', () => {
      expect(formatElapsedClockTime(-1_000)).toBe('00:00');
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
