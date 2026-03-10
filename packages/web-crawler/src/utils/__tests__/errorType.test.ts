import { describe, expect, it } from 'vitest';

import {
  isFetchNetworkError,
  NetworkConnectionError,
  PageNotFoundError,
  TimeoutError,
  toFetchError,
} from '../errorType';

describe('errorType', () => {
  describe('PageNotFoundError', () => {
    it('should create error with correct message and name', () => {
      const message = 'Page not found';
      const error = new PageNotFoundError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PageNotFoundError);
      expect(error.message).toBe(message);
      expect(error.name).toBe('PageNotFoundError');
    });

    it('should preserve stack trace', () => {
      const error = new PageNotFoundError('Test message');
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
    });

    it('should be throwable and catchable', () => {
      const message = 'Custom 404 message';

      expect(() => {
        throw new PageNotFoundError(message);
      }).toThrow(PageNotFoundError);

      expect(() => {
        throw new PageNotFoundError(message);
      }).toThrow(message);
    });

    it('should handle empty message', () => {
      const error = new PageNotFoundError('');
      expect(error.message).toBe('');
      expect(error.name).toBe('PageNotFoundError');
    });

    it('should handle special characters in message', () => {
      const specialMessage = 'Page not found: ëñçødéd tëxt & symbols!@#$%^&*()';
      const error = new PageNotFoundError(specialMessage);
      expect(error.message).toBe(specialMessage);
      expect(error.name).toBe('PageNotFoundError');
    });
  });

  describe('NetworkConnectionError', () => {
    it('should create error with default message and correct name', () => {
      const error = new NetworkConnectionError();

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(NetworkConnectionError);
      expect(error.message).toBe('Network connection error');
      expect(error.name).toBe('NetworkConnectionError');
    });

    it('should preserve stack trace', () => {
      const error = new NetworkConnectionError();
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
    });

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new NetworkConnectionError();
      }).toThrow(NetworkConnectionError);

      expect(() => {
        throw new NetworkConnectionError();
      }).toThrow('Network connection error');
    });

    it('should always have the same message regardless of parameters', () => {
      const error1 = new NetworkConnectionError();
      const error2 = new NetworkConnectionError();

      expect(error1.message).toBe(error2.message);
      expect(error1.name).toBe(error2.name);
      expect(error1.message).toBe('Network connection error');
    });
  });

  describe('TimeoutError', () => {
    it('should create error with correct message and name', () => {
      const message = 'Request timeout after 30 seconds';
      const error = new TimeoutError(message);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.message).toBe(message);
      expect(error.name).toBe('TimeoutError');
    });

    it('should preserve stack trace', () => {
      const error = new TimeoutError('Test timeout');
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
    });

    it('should be throwable and catchable', () => {
      const message = 'Custom timeout message';

      expect(() => {
        throw new TimeoutError(message);
      }).toThrow(TimeoutError);

      expect(() => {
        throw new TimeoutError(message);
      }).toThrow(message);
    });

    it('should handle empty message', () => {
      const error = new TimeoutError('');
      expect(error.message).toBe('');
      expect(error.name).toBe('TimeoutError');
    });

    it('should handle numeric timeout values in message', () => {
      const timeoutMessage = 'Request timed out after 5000ms';
      const error = new TimeoutError(timeoutMessage);
      expect(error.message).toBe(timeoutMessage);
      expect(error.name).toBe('TimeoutError');
    });
  });

  describe('error inheritance', () => {
    it('should all extend from base Error class', () => {
      const pageError = new PageNotFoundError('404');
      const networkError = new NetworkConnectionError();
      const timeoutError = new TimeoutError('timeout');

      expect(pageError).toBeInstanceOf(Error);
      expect(networkError).toBeInstanceOf(Error);
      expect(timeoutError).toBeInstanceOf(Error);
    });

    it('should be distinguishable by instanceof', () => {
      const pageError = new PageNotFoundError('404');
      const networkError = new NetworkConnectionError();
      const timeoutError = new TimeoutError('timeout');

      expect(pageError).toBeInstanceOf(PageNotFoundError);
      expect(pageError).not.toBeInstanceOf(NetworkConnectionError);
      expect(pageError).not.toBeInstanceOf(TimeoutError);

      expect(networkError).toBeInstanceOf(NetworkConnectionError);
      expect(networkError).not.toBeInstanceOf(PageNotFoundError);
      expect(networkError).not.toBeInstanceOf(TimeoutError);

      expect(timeoutError).toBeInstanceOf(TimeoutError);
      expect(timeoutError).not.toBeInstanceOf(PageNotFoundError);
      expect(timeoutError).not.toBeInstanceOf(NetworkConnectionError);
    });

    it('should be distinguishable by name property', () => {
      const pageError = new PageNotFoundError('404');
      const networkError = new NetworkConnectionError();
      const timeoutError = new TimeoutError('timeout');

      expect(pageError.name).toBe('PageNotFoundError');
      expect(networkError.name).toBe('NetworkConnectionError');
      expect(timeoutError.name).toBe('TimeoutError');

      // Names should be unique
      const names = [pageError.name, networkError.name, timeoutError.name];
      const uniqueNames = [...new Set(names)];
      expect(uniqueNames).toHaveLength(names.length);
    });
  });

  describe('isFetchNetworkError', () => {
    it('should return true for TypeError with "fetch failed" message', () => {
      expect(isFetchNetworkError(new TypeError('fetch failed'))).toBe(true);
    });

    it('should return false for plain Error with "fetch failed" message', () => {
      expect(isFetchNetworkError(new Error('fetch failed'))).toBe(false);
    });

    it('should return false for TypeError with different message', () => {
      expect(isFetchNetworkError(new TypeError('something else'))).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isFetchNetworkError('fetch failed')).toBe(false);
      expect(isFetchNetworkError(null)).toBe(false);
      expect(isFetchNetworkError(undefined)).toBe(false);
    });
  });

  describe('toFetchError', () => {
    it('should return NetworkConnectionError for fetch network errors', () => {
      const result = toFetchError(new TypeError('fetch failed'));
      expect(result).toBeInstanceOf(NetworkConnectionError);
    });

    it('should return TimeoutError as-is', () => {
      const timeout = new TimeoutError('Request timeout after 10000ms');
      expect(toFetchError(timeout)).toBe(timeout);
    });

    it('should return unknown errors unchanged', () => {
      const unknown = new Error('something unexpected');
      expect(toFetchError(unknown)).toBe(unknown);
    });
  });

  describe('error catching scenarios', () => {
    it('should allow catching specific error types', () => {
      const testErrors = [
        new PageNotFoundError('404 error'),
        new NetworkConnectionError(),
        new TimeoutError('timeout error'),
      ];

      testErrors.forEach((error) => {
        try {
          throw error;
        } catch (e) {
          if (e instanceof PageNotFoundError) {
            expect(e.name).toBe('PageNotFoundError');
            expect(e.message).toBe('404 error');
          } else if (e instanceof NetworkConnectionError) {
            expect(e.name).toBe('NetworkConnectionError');
            expect(e.message).toBe('Network connection error');
          } else if (e instanceof TimeoutError) {
            expect(e.name).toBe('TimeoutError');
            expect(e.message).toBe('timeout error');
          } else {
            throw new Error('Unexpected error type');
          }
        }
      });
    });

    it('should allow catching by error name', () => {
      const testCases = [
        { error: new PageNotFoundError('test'), expectedName: 'PageNotFoundError' },
        { error: new NetworkConnectionError(), expectedName: 'NetworkConnectionError' },
        { error: new TimeoutError('test'), expectedName: 'TimeoutError' },
      ];

      testCases.forEach(({ error, expectedName }) => {
        try {
          throw error;
        } catch (e) {
          expect((e as Error).name).toBe(expectedName);
        }
      });
    });
  });
});
