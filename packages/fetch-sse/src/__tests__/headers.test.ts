import { describe, expect, it } from 'vitest';

import { headersToRecord } from '../headers';

describe('headersToRecord', () => {
  describe('undefined or null input', () => {
    it('should return empty object when headersInit is undefined', () => {
      // Arrange & Act
      const result = headersToRecord(undefined);

      // Assert
      expect(result).toEqual({});
    });

    it('should return empty object when headersInit is not provided', () => {
      // Arrange & Act
      const result = headersToRecord();

      // Assert
      expect(result).toEqual({});
    });
  });

  describe('Headers instance', () => {
    it('should convert Headers instance to record', () => {
      // Arrange
      const headers = new Headers();
      headers.append('content-type', 'application/json');
      headers.append('authorization', 'Bearer token123');
      headers.append('x-custom-header', 'custom-value');

      // Act
      const result = headersToRecord(headers);

      // Assert
      expect(result).toEqual({
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
        'x-custom-header': 'custom-value',
      });
    });

    it('should handle Headers instance with multiple values for same key', () => {
      // Arrange
      const headers = new Headers();
      headers.append('accept', 'application/json');
      headers.append('accept', 'text/html');

      // Act
      const result = headersToRecord(headers);

      // Assert
      expect(result).toHaveProperty('accept');
      expect(typeof result.accept).toBe('string');
    });

    it('should handle empty Headers instance', () => {
      // Arrange
      const headers = new Headers();

      // Act
      const result = headersToRecord(headers);

      // Assert
      expect(result).toEqual({});
    });
  });

  describe('Array format', () => {
    it('should convert array of tuples to record', () => {
      // Arrange
      const headersArray: [string, string][] = [
        ['content-type', 'application/json'],
        ['authorization', 'Bearer token123'],
        ['x-api-key', 'api-key-value'],
      ];

      // Act
      const result = headersToRecord(headersArray);

      // Assert
      expect(result).toEqual({
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
        'x-api-key': 'api-key-value',
      });
    });

    it('should handle empty array', () => {
      // Arrange
      const headersArray: [string, string][] = [];

      // Act
      const result = headersToRecord(headersArray);

      // Assert
      expect(result).toEqual({});
    });

    it('should handle array with single header', () => {
      // Arrange
      const headersArray: [string, string][] = [['x-single-header', 'single-value']];

      // Act
      const result = headersToRecord(headersArray);

      // Assert
      expect(result).toEqual({
        'x-single-header': 'single-value',
      });
    });
  });

  describe('Plain object', () => {
    it('should convert plain object to record', () => {
      // Arrange
      const headersObj = {
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
        'x-custom': 'value',
      };

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).toEqual({
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
        'x-custom': 'value',
      });
    });

    it('should handle empty object', () => {
      // Arrange
      const headersObj = {};

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).toEqual({});
    });

    it('should handle object with special characters in values', () => {
      // Arrange
      const headersObj = {
        'authorization': 'Bearer test-token',
        'x-special': 'value with spaces and symbols: !@#$%',
      };

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).toEqual({
        'authorization': 'Bearer test-token',
        'x-special': 'value with spaces and symbols: !@#$%',
      });
    });
  });

  describe('Restricted headers filtering', () => {
    it('should remove "host" header from Headers instance', () => {
      // Arrange
      const headers = new Headers();
      headers.append('host', 'example.com');
      headers.append('content-type', 'application/json');

      // Act
      const result = headersToRecord(headers);

      // Assert
      expect(result).not.toHaveProperty('host');
      expect(result).toEqual({
        'content-type': 'application/json',
      });
    });

    it('should remove "connection" header from array', () => {
      // Arrange
      const headersArray: [string, string][] = [
        ['connection', 'keep-alive'],
        ['authorization', 'Bearer token'],
      ];

      // Act
      const result = headersToRecord(headersArray);

      // Assert
      expect(result).not.toHaveProperty('connection');
      expect(result).toEqual({
        authorization: 'Bearer token',
      });
    });

    it('should remove "content-length" header from plain object', () => {
      // Arrange
      const headersObj = {
        'content-length': '1234',
        'content-type': 'application/json',
      };

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).not.toHaveProperty('content-length');
      expect(result).toEqual({
        'content-type': 'application/json',
      });
    });

    it('should remove all restricted headers (host, connection, content-length)', () => {
      // Arrange
      const headersObj = {
        'host': 'example.com',
        'connection': 'keep-alive',
        'content-length': '1234',
        'authorization': 'Bearer token',
        'content-type': 'application/json',
      };

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).not.toHaveProperty('host');
      expect(result).not.toHaveProperty('connection');
      expect(result).not.toHaveProperty('content-length');
      expect(result).toEqual({
        'authorization': 'Bearer token',
        'content-type': 'application/json',
      });
    });

    it('should handle case when only restricted headers are present', () => {
      // Arrange
      const headersObj = {
        'host': 'example.com',
        'connection': 'keep-alive',
        'content-length': '1234',
      };

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).toEqual({});
    });
  });

  describe('Edge cases', () => {
    it('should handle headers with empty string values', () => {
      // Arrange
      const headersObj = {
        'x-empty': '',
        'x-normal': 'value',
      };

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).toEqual({
        'x-empty': '',
        'x-normal': 'value',
      });
    });

    it('should handle headers with numeric-like values as strings', () => {
      // Arrange
      const headersArray: [string, string][] = [
        ['x-request-id', '12345'],
        ['x-retry-count', '3'],
      ];

      // Act
      const result = headersToRecord(headersArray);

      // Assert
      expect(result).toEqual({
        'x-request-id': '12345',
        'x-retry-count': '3',
      });
    });

    it('should handle case-sensitive header names', () => {
      // Arrange
      const headersObj = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token',
      };

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).toEqual({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token',
      });
    });

    it('should preserve header order from array input', () => {
      // Arrange
      const headersArray: [string, string][] = [
        ['z-last', 'last'],
        ['a-first', 'first'],
        ['m-middle', 'middle'],
      ];

      // Act
      const result = headersToRecord(headersArray);

      // Assert
      expect(Object.keys(result)).toEqual(['z-last', 'a-first', 'm-middle']);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical SSE request headers', () => {
      // Arrange
      const headers = new Headers();
      headers.append('accept', 'text/event-stream');
      headers.append('content-type', 'application/json');
      headers.append('authorization', 'Bearer abc123');
      headers.append('cache-control', 'no-cache');
      headers.append('connection', 'keep-alive'); // Should be filtered

      // Act
      const result = headersToRecord(headers);

      // Assert
      expect(result).toEqual({
        'accept': 'text/event-stream',
        'content-type': 'application/json',
        'authorization': 'Bearer abc123',
        'cache-control': 'no-cache',
      });
      expect(result).not.toHaveProperty('connection');
    });

    it('should handle API request headers with custom fields', () => {
      // Arrange
      const headersObj = {
        'content-type': 'application/json',
        'x-api-key': 'secret-key',
        'x-request-id': 'req-123',
        'user-agent': 'MyApp/1.0',
        'host': 'api.example.com', // Should be filtered
        'content-length': '256', // Should be filtered
      };

      // Act
      const result = headersToRecord(headersObj);

      // Assert
      expect(result).toEqual({
        'content-type': 'application/json',
        'x-api-key': 'secret-key',
        'x-request-id': 'req-123',
        'user-agent': 'MyApp/1.0',
      });
    });
  });
});
