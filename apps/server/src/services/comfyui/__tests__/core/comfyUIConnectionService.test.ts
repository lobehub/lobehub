import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComfyUIConnectionService } from '@/server/services/comfyui/core/comfyUIConnectionService';
import { ServicesError } from '@/server/services/comfyui/errors';

// Mock global fetch
global.fetch = vi.fn();

describe('ComfyUIConnectionService', () => {
  let service: ComfyUIConnectionService;
  const mockFetch = vi.mocked(fetch);

  beforeEach(() => {
    service = new ComfyUIConnectionService();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Constructor and initialization', () => {
    it('should initialize with default state', () => {
      const newService = new ComfyUIConnectionService();

      expect(newService.isValidated()).toBe(false);

      const status = newService.getStatus();
      expect(status.isValidated).toBe(false);
      expect(status.lastValidationTime).toBe(null);
      expect(status.timeUntilExpiry).toBe(null);
    });
  });

  describe('Connection validation', () => {
    const baseURL = 'http://localhost:8188';
    const authHeaders = { Authorization: 'Bearer test-token' };

    it('should validate connection successfully', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ system: 'data' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await service.validateConnection(baseURL, authHeaders);

      expect(result).toBe(true);
      expect(service.isValidated()).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(`${baseURL}/system_stats`, {
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        method: 'GET',
        mode: 'cors',
      });
    });

    it('should validate connection without auth headers', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ system: 'data' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await service.validateConnection(baseURL);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(`${baseURL}/system_stats`, {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'GET',
        mode: 'cors',
      });
    });

    it('should return cached validation result within TTL', async () => {
      // First validation
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ system: 'data' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await service.validateConnection(baseURL, authHeaders);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second validation within TTL should use cached result
      const result = await service.validateConnection(baseURL, authHeaders);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional fetch call
    });

    it('should re-validate after TTL expiry', async () => {
      // First validation
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ system: 'data' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await service.validateConnection(baseURL, authHeaders);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Fast-forward time beyond TTL (5 minutes + 1 second)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      // Second validation after TTL should make new request
      const result = await service.validateConnection(baseURL, authHeaders);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle HTTP error responses', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await expect(service.validateConnection(baseURL, authHeaders)).rejects.toThrow(ServicesError);
      expect(service.isValidated()).toBe(false);
    });

    it('should handle invalid JSON response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(null),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await expect(service.validateConnection(baseURL, authHeaders)).rejects.toThrow(ServicesError);
      expect(service.isValidated()).toBe(false);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(service.validateConnection(baseURL, authHeaders)).rejects.toThrow(Error);
      expect(service.isValidated()).toBe(false);
    });

    it('should handle JSON parse errors', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('JSON parse error')),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await expect(service.validateConnection(baseURL, authHeaders)).rejects.toThrow(Error);
      expect(service.isValidated()).toBe(false);
    });
  });

  describe('Connection state management', () => {
    it('should mark connection as validated', () => {
      service.markAsValidated();

      expect(service.isValidated()).toBe(true);

      const status = service.getStatus();
      expect(status.isValidated).toBe(true);
      expect(status.lastValidationTime).toBeGreaterThan(0);
      expect(status.timeUntilExpiry).toBeGreaterThan(0);
    });

    it('should invalidate connection', () => {
      service.markAsValidated();
      expect(service.isValidated()).toBe(true);

      service.invalidate();
      expect(service.isValidated()).toBe(false);

      const status = service.getStatus();
      expect(status.isValidated).toBe(false);
      expect(status.lastValidationTime).toBe(null);
      expect(status.timeUntilExpiry).toBe(null);
    });

    it('should expire validation after TTL', () => {
      service.markAsValidated();
      expect(service.isValidated()).toBe(true);

      // Fast-forward time beyond TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

      expect(service.isValidated()).toBe(false);
    });
  });

  describe('Connection status', () => {
    it('should return correct status for unvalidated connection', () => {
      const status = service.getStatus();

      expect(status.isValidated).toBe(false);
      expect(status.lastValidationTime).toBe(null);
      expect(status.timeUntilExpiry).toBe(null);
    });

    it('should return correct status for validated connection', () => {
      service.markAsValidated();

      const status = service.getStatus();

      expect(status.isValidated).toBe(true);
      expect(status.lastValidationTime).toBeGreaterThan(0);
      expect(status.timeUntilExpiry).toBeGreaterThan(0);
      expect(status.timeUntilExpiry).toBeLessThanOrEqual(5 * 60 * 1000); // Should be <= 5 minutes
    });

    it('should calculate time until expiry correctly', () => {
      service.markAsValidated();

      // Advance time by 2 minutes
      vi.advanceTimersByTime(2 * 60 * 1000);

      const status = service.getStatus();
      expect(status.timeUntilExpiry).toBeCloseTo(3 * 60 * 1000, -2); // ~3 minutes remaining
    });

    it('should return zero time until expiry when expired', () => {
      service.markAsValidated();

      // Advance time beyond TTL
      vi.advanceTimersByTime(6 * 60 * 1000);

      const status = service.getStatus();
      expect(status.timeUntilExpiry).toBe(0);
    });
  });

  describe('Edge cases', () => {
    const baseURL = 'http://localhost:8188';
    const authHeaders = { Authorization: 'Bearer test-token' };

    it('should handle multiple rapid validation calls', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ system: 'data' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      // Make multiple concurrent validation calls
      const promises = [
        service.validateConnection(baseURL, authHeaders),
        service.validateConnection(baseURL, authHeaders),
        service.validateConnection(baseURL, authHeaders),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every((r) => r === true)).toBe(true);

      // For concurrent calls, each call checks the cache independently
      // Since they start before any completes, they will all make HTTP requests
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // After all complete, subsequent calls should use cache
      await service.validateConnection(baseURL, authHeaders);
      expect(mockFetch).toHaveBeenCalledTimes(3); // No additional call
    });

    it('should handle validation with empty auth headers object', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ system: 'data' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await service.validateConnection(baseURL, {});

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(`${baseURL}/system_stats`, {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'GET',
        mode: 'cors',
      });
    });
  });
});
