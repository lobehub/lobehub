/**
 * E2E Mock Framework
 *
 * This module provides a centralized way to mock API responses in E2E tests.
 * It uses Playwright's route interception to mock tRPC and REST API calls.
 */
import type { Page, Route } from 'playwright';

import { discoverMocks } from './community';

// ============================================
// Types
// ============================================

export interface MockHandler {
  /** Optional: only apply this mock when condition is true */
  enabled?: boolean;
  /** Handler function to process the request */
  handler: (route: Route, request: Request) => Promise<void>;
  /** URL pattern to match (supports wildcards) */
  pattern: string | RegExp;
}

export interface MockConfig {
  /** Enable/disable all mocks globally */
  enabled: boolean;
  /** Mock handlers grouped by domain */
  handlers: Record<string, MockHandler[]>;
}

// ============================================
// Default Configuration
// ============================================

const defaultConfig: MockConfig = {
  enabled: true,
  handlers: {
    community: discoverMocks,
    // Add more domains here as needed:
    // user: userMocks,
    // chat: chatMocks,
  },
};

// ============================================
// Mock Manager
// ============================================

export class MockManager {
  private config: MockConfig;
  private page: Page | null = null;

  constructor(config: Partial<MockConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Setup all mock handlers for a page
   */
  async setup(page: Page): Promise<void> {
    this.page = page;

    if (!this.config.enabled) {
      console.log('🔇 Mocks disabled');
      return;
    }

    console.log('🎭 Setting up API mocks...');

    for (const [domain, handlers] of Object.entries(this.config.handlers)) {
      for (const mock of handlers) {
        if (mock.enabled === false) continue;

        await page.route(mock.pattern, async (route) => {
          try {
            await mock.handler(route, route.request() as unknown as Request);
          } catch (error) {
            console.error(`Mock handler error for ${mock.pattern}:`, error);
            await route.continue();
          }
        });
      }
      console.log(`   ✓ ${domain} mocks registered`);
    }
  }

  /**
   * Disable a specific mock domain
   */
  disableDomain(domain: string): void {
    if (this.config.handlers[domain]) {
      for (const handler of this.config.handlers[domain]) {
        handler.enabled = false;
      }
    }
  }

  /**
   * Enable a specific mock domain
   */
  enableDomain(domain: string): void {
    if (this.config.handlers[domain]) {
      for (const handler of this.config.handlers[domain]) {
        handler.enabled = true;
      }
    }
  }

  /**
   * Add custom mock handlers at runtime
   */
  addHandlers(domain: string, handlers: MockHandler[]): void {
    if (!this.config.handlers[domain]) {
      this.config.handlers[domain] = [];
    }
    this.config.handlers[domain].push(...handlers);
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Create a JSON response for tRPC endpoints
 */
export function createTrpcResponse<T>(data: T): string {
  return JSON.stringify({
    result: {
      data,
    },
  });
}

/**
 * Create an error response for tRPC endpoints
 */
export function createTrpcError(message: string, code = 'INTERNAL_SERVER_ERROR'): string {
  return JSON.stringify({
    error: {
      code,
      message,
    },
  });
}

/**
 * Create a standard JSON response
 */
export function createJsonResponse<T>(data: T): string {
  return JSON.stringify(data);
}

// ============================================
// Singleton Instance
// ============================================

export const mockManager = new MockManager();
