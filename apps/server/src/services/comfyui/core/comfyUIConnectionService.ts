/**
 * ComfyUI Connection Service
 *
 * Handles connection validation and state management for ComfyUI server
 * Provides TTL-based connection validation caching
 */
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import debug from 'debug';

import { ServicesError } from '@/server/services/comfyui/errors';

const log = debug('lobe-image:comfyui:connection');

export class ComfyUIConnectionService {
  private validated: boolean = false;
  private lastValidationTime: number = 0;
  private readonly validationTTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    log('🔗 Initializing connection service');
  }

  /**
   * Check if connection is validated and not expired
   */
  isValidated(): boolean {
    if (!this.validated) return false;

    const now = Date.now();
    if (now - this.lastValidationTime > this.validationTTL) {
      this.validated = false;
      return false;
    }

    return true;
  }

  /**
   * Mark connection as validated
   */
  markAsValidated(): void {
    this.validated = true;
    this.lastValidationTime = Date.now();
    log('✅ Connection marked as validated');
  }

  /**
   * Invalidate connection (force re-validation)
   */
  invalidate(): void {
    this.validated = false;
    log('❌ Connection invalidated, will require re-validation');
  }

  /**
   * Validate connection to ComfyUI server
   * Uses system_stats endpoint for health check
   */
  async validateConnection(
    baseURL: string,
    authHeaders?: Record<string, string>,
  ): Promise<boolean> {
    // Check if already validated and not expired
    if (this.isValidated()) {
      return true;
    }

    try {
      // Use system_stats endpoint for health check
      // This is a lightweight endpoint that returns system information
      const url = `${baseURL}/system_stats`;
      const headers = authHeaders || {};

      log('🔍 Validating connection to:', url);

      // The ComfyUI baseURL is user-configurable, so the health check must go
      // through the SSRF policy (T-07).
      const response = await ssrfSafeFetch(url, {
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        method: 'GET',
        mode: 'cors',
      });

      // Just check if we got a successful response
      if (!response.ok) {
        this.invalidate();
        // Throw ServicesError with status for error parser to handle
        throw new ServicesError(
          `HTTP ${response.status}: ${response.statusText}`,
          ServicesError.Reasons.CONNECTION_FAILED,
          { endpoint: '/system_stats', status: response.status, statusText: response.statusText },
        );
      }

      // Verify response is valid JSON
      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new ServicesError(
          'Invalid response from ComfyUI server',
          ServicesError.Reasons.CONNECTION_FAILED,
          { endpoint: '/system_stats' },
        );
      }

      this.markAsValidated();
      log('✅ Connection validated successfully');
      return true;
    } catch (error) {
      // Reset connection state on any error
      this.invalidate();

      // Re-throw all errors - let the service layer handle error classification
      throw error;
    }
  }

  /**
   * Get connection status information
   */
  getStatus(): {
    isValidated: boolean;
    lastValidationTime: number | null;
    timeUntilExpiry: number | null;
  } {
    const now = Date.now();
    const timeUntilExpiry = this.validated
      ? Math.max(0, this.validationTTL - (now - this.lastValidationTime))
      : null;

    return {
      isValidated: this.validated,
      lastValidationTime: this.validated ? this.lastValidationTime : null,
      timeUntilExpiry,
    };
  }
}
