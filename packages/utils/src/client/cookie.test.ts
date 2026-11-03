import dayjs from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COOKIE_CACHE_DAYS, setCookie } from './cookie';

describe('setCookie', () => {
  // Mock document.cookie since we're in a test environment
  beforeEach(() => {
    // Create a getter/setter for document.cookie
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
    });
  });

  it('should set a cookie with default expiration', () => {
    const key = 'testKey';
    const value = 'testValue';

    // Mock the current date
    const mockDate = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(mockDate);

    // Calculate expected expiration date
    const expectedExpires = dayjs(mockDate).add(COOKIE_CACHE_DAYS, 'day').toDate().toUTCString();

    setCookie(key, value);

    expect(document.cookie).toBe(`${key}=${value};expires=${expectedExpires};path=/;`);

    // Reset system time
    vi.useRealTimers();
  });

  it('should set a cookie with custom expiration days', () => {
    const key = 'testKey';
    const value = 'testValue';
    const customDays = 7;

    // Mock the current date
    const mockDate = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(mockDate);

    // Calculate expected expiration date
    const expectedExpires = dayjs(mockDate).add(customDays, 'day').toDate().toUTCString();

    setCookie(key, value, customDays);

    expect(document.cookie).toBe(`${key}=${value};expires=${expectedExpires};path=/;`);

    // Reset system time
    vi.useRealTimers();
  });

  it('should remove cookie when value is undefined', () => {
    const key = 'testKey';

    // Expected expiration date for removal (1970-01-01T00:00:00Z)
    const expectedExpires = new Date(0).toUTCString();

    setCookie(key, undefined);

    expect(document.cookie).toBe(`${key}=; expires=${expectedExpires}; path=/;`);
  });

  it('should handle special characters in key and value', () => {
    const key = 'test@Key';
    const value = 'test Value with spaces';

    // Mock the current date
    const mockDate = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(mockDate);

    const expectedExpires = dayjs(mockDate).add(COOKIE_CACHE_DAYS, 'day').toDate().toUTCString();

    setCookie(key, value);

    expect(document.cookie).toBe(`${key}=${value};expires=${expectedExpires};path=/;`);

    // Reset system time
    vi.useRealTimers();
  });
});
