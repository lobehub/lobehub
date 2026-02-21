import { type NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { createRouteMatcher } from './createRouteMatcher';

// Helper to create a mock NextRequest with a given pathname
const createMockRequest = (pathname: string): NextRequest =>
  ({
    nextUrl: { pathname },
  }) as NextRequest;

describe('createRouteMatcher', () => {
  describe('exact path matching', () => {
    it('should match exact paths', () => {
      const matcher = createRouteMatcher(['/signin', '/signup']);

      expect(matcher(createMockRequest('/signin'))).toBe(true);
      expect(matcher(createMockRequest('/signup'))).toBe(true);
      expect(matcher(createMockRequest('/login'))).toBe(false);
    });

    it('should not match partial paths without wildcard', () => {
      const matcher = createRouteMatcher(['/api']);

      expect(matcher(createMockRequest('/api'))).toBe(true);
      expect(matcher(createMockRequest('/api/users'))).toBe(false);
      expect(matcher(createMockRequest('/api/'))).toBe(false);
    });
  });

  describe('wildcard pattern matching', () => {
    it('should match paths with (.*) wildcard', () => {
      const matcher = createRouteMatcher(['/api/auth(.*)']);

      expect(matcher(createMockRequest('/api/auth'))).toBe(true);
      expect(matcher(createMockRequest('/api/auth/'))).toBe(true);
      expect(matcher(createMockRequest('/api/auth/callback'))).toBe(true);
      expect(matcher(createMockRequest('/api/auth/callback/google'))).toBe(true);
      expect(matcher(createMockRequest('/api/other'))).toBe(false);
    });

    it('should match /share(.*) pattern for public share pages', () => {
      const matcher = createRouteMatcher(['/share(.*)']);

      expect(matcher(createMockRequest('/share'))).toBe(true);
      expect(matcher(createMockRequest('/share/'))).toBe(true);
      expect(matcher(createMockRequest('/share/abc123'))).toBe(true);
      expect(matcher(createMockRequest('/share/t/abc123'))).toBe(true);
      // Note: /shared also matches because (.*) matches 'd' - use /share/(.*) for strict matching
      expect(matcher(createMockRequest('/shared'))).toBe(true);
    });

    it('should match /trpc(.*) pattern', () => {
      const matcher = createRouteMatcher(['/trpc(.*)']);

      expect(matcher(createMockRequest('/trpc'))).toBe(true);
      expect(matcher(createMockRequest('/trpc/user.get'))).toBe(true);
      expect(matcher(createMockRequest('/trpc/chat.create'))).toBe(true);
    });
  });

  describe('multiple patterns', () => {
    it('should match any of multiple patterns', () => {
      const matcher = createRouteMatcher(['/api/auth(.*)', '/signin', '/share(.*)']);

      expect(matcher(createMockRequest('/api/auth/callback'))).toBe(true);
      expect(matcher(createMockRequest('/signin'))).toBe(true);
      expect(matcher(createMockRequest('/share/abc'))).toBe(true);
      expect(matcher(createMockRequest('/other'))).toBe(false);
    });
  });

  describe('special regex characters', () => {
    it('should escape special regex characters in patterns', () => {
      const matcher = createRouteMatcher(['/api/v1.0/users']);

      expect(matcher(createMockRequest('/api/v1.0/users'))).toBe(true);
      expect(matcher(createMockRequest('/api/v1X0/users'))).toBe(false); // . should not match any char
    });

    it('should handle patterns with multiple special characters', () => {
      const matcher = createRouteMatcher(['/oauth/consent/(.*)']);

      expect(matcher(createMockRequest('/oauth/consent/'))).toBe(true);
      expect(matcher(createMockRequest('/oauth/consent/abc123'))).toBe(true);
      expect(matcher(createMockRequest('/oauth/consent'))).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle root path', () => {
      const matcher = createRouteMatcher(['/']);

      expect(matcher(createMockRequest('/'))).toBe(true);
      expect(matcher(createMockRequest('/anything'))).toBe(false);
    });

    it('should handle empty patterns array', () => {
      const matcher = createRouteMatcher([]);

      expect(matcher(createMockRequest('/'))).toBe(false);
      expect(matcher(createMockRequest('/any/path'))).toBe(false);
    });

    it('should be case sensitive', () => {
      const matcher = createRouteMatcher(['/API/auth(.*)']);

      expect(matcher(createMockRequest('/API/auth/callback'))).toBe(true);
      expect(matcher(createMockRequest('/api/auth/callback'))).toBe(false);
    });
  });
});
