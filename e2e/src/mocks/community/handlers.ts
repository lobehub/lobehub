/**
 * Mock handlers for Discover/Community API endpoints
 */
import type { Route } from 'playwright';

import { type MockHandler, createTrpcResponse } from '../index';
import {
  mockAssistantCategories,
  mockAssistantList,
  mockMcpCategories,
  mockMcpList,
  mockModelList,
  mockProviderList,
} from './data';

// ============================================
// Helper to parse tRPC batch requests
// ============================================

function parseTrpcUrl(url: string): { input?: Record<string, unknown>; procedure: string } {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname;

  // Extract procedure name from path like /trpc/lambda.market.getAssistantList
  const procedureMatch = pathname.match(/lambda\.market\.(\w+)/);
  const procedure = procedureMatch ? procedureMatch[1] : '';

  // Parse input from query string
  let input: Record<string, unknown> | undefined;
  const inputParam = urlObj.searchParams.get('input');
  if (inputParam) {
    try {
      input = JSON.parse(inputParam);
    } catch {
      // Ignore parse errors
    }
  }

  return { input, procedure };
}

// ============================================
// Mock Handlers
// ============================================

/**
 * Handler for assistant list endpoint
 */
const assistantListHandler: MockHandler = {
  handler: async (route: Route) => {
    await route.fulfill({
      body: createTrpcResponse(mockAssistantList),
      contentType: 'application/json',
      status: 200,
    });
  },
  pattern: '**/trpc/lambda/market.getAssistantList**',
};

/**
 * Handler for assistant categories endpoint
 */
const assistantCategoriesHandler: MockHandler = {
  handler: async (route: Route) => {
    await route.fulfill({
      body: createTrpcResponse(mockAssistantCategories),
      contentType: 'application/json',
      status: 200,
    });
  },
  pattern: '**/trpc/lambda/market.getAssistantCategories**',
};

/**
 * Handler for model list endpoint
 */
const modelListHandler: MockHandler = {
  handler: async (route: Route) => {
    await route.fulfill({
      body: createTrpcResponse(mockModelList),
      contentType: 'application/json',
      status: 200,
    });
  },
  pattern: '**/trpc/lambda/market.getModelList**',
};

/**
 * Handler for provider list endpoint
 */
const providerListHandler: MockHandler = {
  handler: async (route: Route) => {
    await route.fulfill({
      body: createTrpcResponse(mockProviderList),
      contentType: 'application/json',
      status: 200,
    });
  },
  pattern: '**/trpc/lambda/market.getProviderList**',
};

/**
 * Handler for MCP list endpoint
 */
const mcpListHandler: MockHandler = {
  handler: async (route: Route) => {
    await route.fulfill({
      body: createTrpcResponse(mockMcpList),
      contentType: 'application/json',
      status: 200,
    });
  },
  pattern: '**/trpc/lambda/market.getMcpList**',
};

/**
 * Handler for MCP categories endpoint
 */
const mcpCategoriesHandler: MockHandler = {
  handler: async (route: Route) => {
    await route.fulfill({
      body: createTrpcResponse(mockMcpCategories),
      contentType: 'application/json',
      status: 200,
    });
  },
  pattern: '**/trpc/lambda/market.getMcpCategories**',
};

/**
 * Debug handler to log all trpc requests
 */
const trpcDebugHandler: MockHandler = {
  handler: async (route: Route) => {
    const url = route.request().url();
    console.log(`   🔍 TRPC Request: ${url}`);
    await route.continue();
  },
  pattern: '**/trpc/**',
};

/**
 * Fallback handler for any unhandled market endpoints
 * Returns empty data to prevent hanging requests
 */
const marketFallbackHandler: MockHandler = {
  handler: async (route: Route) => {
    const url = route.request().url();
    const { procedure } = parseTrpcUrl(url);

    console.log(`   ⚠️ Unhandled market endpoint: ${procedure}`);

    // Return empty response to prevent timeout
    await route.fulfill({
      body: createTrpcResponse({ items: [], pagination: { page: 1, pageSize: 12, total: 0 } }),
      contentType: 'application/json',
      status: 200,
    });
  },
  pattern: '**/trpc/lambda/market.**',
};

// ============================================
// Export all handlers
// ============================================

export const discoverHandlers: MockHandler[] = [
  // Debug handler first to log all requests
  trpcDebugHandler,
  // Specific handlers (order matters - more specific first)
  assistantListHandler,
  assistantCategoriesHandler,
  modelListHandler,
  providerListHandler,
  mcpListHandler,
  mcpCategoriesHandler,
  // Fallback handler (should be last)
  marketFallbackHandler,
];
