import { describe, expect, it, vi } from 'vitest';

import {
  createTimingHelpers,
  markTimingSinkStageDone,
  markTimingStageDone,
  type TimingLogger,
  type TimingSink,
} from './timing';

describe('timing utilities', () => {
  const context = { requestId: 'req-1', startedAt: Date.now() };

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
