import { describe, expect, it } from 'vitest';

import {
  deleteResponseHeader,
  getResponseHeader,
  hasResponseHeader,
  setResponseHeader,
} from '../http-headers';

describe('http-headers utilities', () => {
  describe('setResponseHeader', () => {
    it('should set a new header', () => {
      const headers: Record<string, string[]> = {};

      setResponseHeader(headers, 'Content-Type', 'application/json');

      expect(headers['Content-Type']).toEqual(['application/json']);
    });

    it('should replace existing header with same case', () => {
      const headers: Record<string, string[]> = {
        'Content-Type': ['text/html'],
      };

      setResponseHeader(headers, 'Content-Type', 'application/json');

      expect(headers['Content-Type']).toEqual(['application/json']);
      expect(Object.keys(headers)).toHaveLength(1);
    });

    it('should replace existing header with different case', () => {
      const headers: Record<string, string[]> = {
        'content-type': ['text/html'],
      };

      setResponseHeader(headers, 'Content-Type', 'application/json');

      expect(headers['Content-Type']).toEqual(['application/json']);
      expect(headers['content-type']).toBeUndefined();
      expect(Object.keys(headers)).toHaveLength(1);
    });

    it('should handle array values', () => {
      const headers: Record<string, string[]> = {};

      setResponseHeader(headers, 'Set-Cookie', ['a=1', 'b=2']);

      expect(headers['Set-Cookie']).toEqual(['a=1', 'b=2']);
    });

    it('should replace multiple headers with different cases', () => {
      const headers: Record<string, string[]> = {
        'ACCESS-CONTROL-ALLOW-ORIGIN': ['*'],
        'access-control-allow-origin': ['http://localhost'],
      };

      setResponseHeader(headers, 'Access-Control-Allow-Origin', 'http://example.com');

      expect(headers['Access-Control-Allow-Origin']).toEqual(['http://example.com']);
      expect(Object.keys(headers)).toHaveLength(1);
    });
  });

  describe('hasResponseHeader', () => {
    it('should return true for existing header', () => {
      const headers = { 'Content-Type': ['application/json'] };

      expect(hasResponseHeader(headers, 'Content-Type')).toBe(true);
    });

    it('should return true for existing header with different case', () => {
      const headers = { 'content-type': ['application/json'] };

      expect(hasResponseHeader(headers, 'Content-Type')).toBe(true);
    });

    it('should return false for non-existing header', () => {
      const headers = { 'Content-Type': ['application/json'] };

      expect(hasResponseHeader(headers, 'Authorization')).toBe(false);
    });
  });

  describe('getResponseHeader', () => {
    it('should get header value', () => {
      const headers = { 'Content-Type': ['application/json'] };

      expect(getResponseHeader(headers, 'Content-Type')).toEqual(['application/json']);
    });

    it('should get header value with different case', () => {
      const headers = { 'content-type': ['application/json'] };

      expect(getResponseHeader(headers, 'Content-Type')).toEqual(['application/json']);
    });

    it('should return undefined for non-existing header', () => {
      const headers = { 'Content-Type': ['application/json'] };

      expect(getResponseHeader(headers, 'Authorization')).toBeUndefined();
    });
  });

  describe('deleteResponseHeader', () => {
    it('should delete existing header', () => {
      const headers: Record<string, string[]> = { 'Content-Type': ['application/json'] };

      const result = deleteResponseHeader(headers, 'Content-Type');

      expect(result).toBe(true);
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('should delete header with different case', () => {
      const headers: Record<string, string[]> = { 'content-type': ['application/json'] };

      const result = deleteResponseHeader(headers, 'Content-Type');

      expect(result).toBe(true);
      expect(headers['content-type']).toBeUndefined();
    });

    it('should return false for non-existing header', () => {
      const headers: Record<string, string[]> = { 'Content-Type': ['application/json'] };

      const result = deleteResponseHeader(headers, 'Authorization');

      expect(result).toBe(false);
    });
  });
});
