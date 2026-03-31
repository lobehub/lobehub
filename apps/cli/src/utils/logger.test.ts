import { afterEach, describe, expect, it, vi } from 'vitest';

import { log, setVerbose } from './logger';

describe('logger', () => {
  const consoleSpy = {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  };
  const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  afterEach(() => {
    setVerbose(false);
    vi.clearAllMocks();
  });

  describe('info', () => {
    it('should log info messages', () => {
      log.info('test message');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        // No extra args
      );
    });

    it('should pass extra args', () => {
      log.info('test %s', 'arg1');
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      log.error('error message');
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
    });
  });

  describe('warn', () => {
    it('should log warning messages', () => {
      log.warn('warning message');
      expect(consoleSpy.warn).toHaveBeenCalledWith(expect.stringContaining('[WARN]'));
    });
  });

  describe('debug', () => {
    it('should not log when verbose is false', () => {
      log.debug('debug message');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('should log when verbose is true', () => {
      setVerbose(true);
      log.debug('debug message');
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'));
    });
  });

  describe('heartbeat', () => {
    it('should not write when verbose is false', () => {
      log.heartbeat();
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it('should write dot when verbose is true', () => {
      setVerbose(true);
      log.heartbeat();
      expect(stdoutWriteSpy).toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('should log connected status', () => {
      log.status('connected');
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[STATUS]'));
    });

    it('should log disconnected status', () => {
      log.status('disconnected');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should log other status', () => {
      log.status('connecting');
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('toolCall', () => {
    it('should log tool call', () => {
      log.toolCall('readFile', 'req-1');
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[TOOL]'));
    });

    it('should log args when verbose', () => {
      setVerbose(true);
      log.toolCall('readFile', 'req-1', '{"path": "/test"}');
      // Should have been called twice (tool call + args)
      expect(consoleSpy.log).toHaveBeenCalledTimes(2);
    });

    it('should not log args when not verbose', () => {
      log.toolCall('readFile', 'req-1', '{"path": "/test"}');
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('toolResult', () => {
    it('should log success result', () => {
      log.toolResult('req-1', true);
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('[RESULT]'));
    });

    it('should log failure result', () => {
      log.toolResult('req-1', false);
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should log content preview when verbose', () => {
      setVerbose(true);
      log.toolResult('req-1', true, 'some content');
      expect(consoleSpy.log).toHaveBeenCalledTimes(2);
    });

    it('should truncate long content in preview', () => {
      setVerbose(true);
      log.toolResult('req-1', true, 'x'.repeat(300));
      expect(consoleSpy.log).toHaveBeenCalledTimes(2);
      // The second call should have truncated content
      const lastCall = consoleSpy.log.mock.calls[1][0];
      expect(lastCall).toContain('...');
    });

    it('should not log content when not verbose', () => {
      log.toolResult('req-1', true, 'some content');
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('setVerbose', () => {
    it('should enable verbose mode', () => {
      setVerbose(true);
      log.debug('should appear');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should disable verbose mode', () => {
      setVerbose(true);
      setVerbose(false);
      log.debug('should not appear');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });
  });
});
