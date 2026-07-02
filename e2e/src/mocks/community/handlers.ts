/**
 * Mock handlers for Discover/Community API endpoints.
 */
import type { Request, Route } from 'playwright';
import superjson from 'superjson';

import type { MockHandler } from '../index';
import {
  mockAssistantCategories,
  mockAssistantDetails,
  mockAssistantItems,
  mockAssistantList,
  mockMcpCategories,
  mockMcpDetails,
  mockMcpItems,
  mockMcpList,
  mockModelDetails,
  mockModelItems,
  mockModelList,
  mockProviderDetails,
  mockProviderItems,
  mockProviderList,
} from './data';

interface IdentifierEntry {
  identifier: string;
  lastModified: string;
}

const SUCCESS_RESPONSE = { success: true };

const createTrpcResult = <T>(data: T) => ({
  result: {
    data: superjson.serialize(data),
  },
});

const createTrpcResponse = <T>(data: T): string => JSON.stringify(createTrpcResult(data));

const createTrpcBatchResponse = <T>(data: T[]): string =>
  JSON.stringify(data.map((item) => createTrpcResult(item)));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getStringInput = (input: unknown, key: string): string | undefined => {
  if (!isRecord(input)) return undefined;
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
};

const getNumberInput = (input: unknown, key: string): number | undefined => {
  if (!isRecord(input)) return undefined;
  const value = input[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const createIdentifiers = (
  items: { identifier: string; updatedAt?: string }[],
): IdentifierEntry[] =>
  items.map((item) => ({ identifier: item.identifier, lastModified: item.updatedAt ?? '' }));

const unwrapTrpcInput = (input: unknown): unknown => {
  if (!isRecord(input)) return input;

  if ('json' in input) return input.json;

  return input;
};

const parseRequestInput = (request: Request, url: URL): unknown => {
  const input = url.searchParams.get('input');

  if (input) {
    try {
      return JSON.parse(input);
    } catch {
      return undefined;
    }
  }

  try {
    return request.postDataJSON();
  } catch {
    return undefined;
  }
};

const getProcedureInputs = (request: Request, url: URL, count: number): unknown[] => {
  const rawInput = parseRequestInput(request, url);
  const isBatch = url.searchParams.get('batch') === '1' || count > 1;

  if (isBatch && isRecord(rawInput)) {
    return Array.from({ length: count }, (_, index) => unwrapTrpcInput(rawInput[String(index)]));
  }

  return [unwrapTrpcInput(rawInput)];
};

const getProcedures = (url: URL): string[] => {
  const marker = '/trpc/lambda/';
  const pathname = decodeURIComponent(url.pathname);
  const markerIndex = pathname.indexOf(marker);

  if (markerIndex === -1) return [];

  const procedureSegment = pathname.slice(markerIndex + marker.length);
  return procedureSegment.split(',').filter(Boolean);
};

const isMarketProcedure = (procedure: string): boolean => procedure.startsWith('market.');

const matchesText = (value: string | undefined, query: string) =>
  value?.toLowerCase().includes(query.toLowerCase()) ?? false;

const paginate = <T>(items: T[], input: unknown, fallbackTotal = items.length) => {
  const page = getNumberInput(input, 'page') ?? 1;
  const pageSize = getNumberInput(input, 'pageSize') ?? 21;

  return {
    currentPage: page,
    items,
    pageSize,
    totalCount: Math.max(fallbackTotal, items.length),
    totalPages: Math.max(1, Math.ceil(Math.max(fallbackTotal, items.length) / pageSize)),
  };
};

const getAssistantList = (input: unknown) => {
  const category = getStringInput(input, 'category');
  const query = getStringInput(input, 'q');

  let items = mockAssistantItems;

  if (category && !['all', 'discover'].includes(category)) {
    const filtered = items.filter((item) => item.category === category);
    if (filtered.length > 0) items = filtered;
  }

  if (query) {
    const filtered = items.filter(
      (item) =>
        matchesText(item.title, query) ||
        matchesText(item.description, query) ||
        matchesText(item.identifier, query) ||
        matchesText(item.tags?.join(' '), query),
    );
    if (filtered.length > 0) items = filtered;
  }

  return { ...mockAssistantList, ...paginate(items, input, 42) };
};

const getMcpList = (input: unknown) => {
  const category = getStringInput(input, 'category');
  const query = getStringInput(input, 'q');

  let items = mockMcpItems;

  if (category && !['all', 'discover'].includes(category)) {
    const filtered = items.filter((item) => item.category === category);
    if (filtered.length > 0) items = filtered;
  }

  if (query) {
    const filtered = items.filter(
      (item) =>
        matchesText(item.name, query) ||
        matchesText(item.description, query) ||
        matchesText(item.identifier, query),
    );
    if (filtered.length > 0) items = filtered;
  }

  return { ...mockMcpList, ...paginate(items, input), categories: mockMcpList.categories };
};

const getModelList = (input: unknown) => {
  const query = getStringInput(input, 'q');

  let items = mockModelItems;
  if (query) {
    const filtered = items.filter(
      (item) =>
        matchesText(item.displayName, query) ||
        matchesText(item.description, query) ||
        matchesText(item.identifier, query),
    );
    if (filtered.length > 0) items = filtered;
  }

  return { ...mockModelList, ...paginate(items, input) };
};

const getProviderList = (input: unknown) => {
  const query = getStringInput(input, 'q');

  let items = mockProviderItems;
  if (query) {
    const filtered = items.filter(
      (item) =>
        matchesText(item.name, query) ||
        matchesText(item.description, query) ||
        matchesText(item.identifier, query),
    );
    if (filtered.length > 0) items = filtered;
  }

  return { ...mockProviderList, ...paginate(items, input) };
};

const findByIdentifier = <T extends { identifier: string }>(items: T[], input: unknown): T => {
  const identifier = getStringInput(input, 'identifier');
  return items.find((item) => item.identifier === identifier) ?? items[0];
};

const getMockResponse = (procedure: string, input: unknown): unknown => {
  switch (procedure) {
    case 'market.getAssistantCategories': {
      return mockAssistantCategories;
    }

    case 'market.getAssistantDetail': {
      return findByIdentifier(mockAssistantDetails, input);
    }

    case 'market.getAssistantIdentifiers': {
      return createIdentifiers(mockAssistantItems);
    }

    case 'market.getAssistantList': {
      return getAssistantList(input);
    }

    case 'market.getMcpCategories': {
      return mockMcpCategories;
    }

    case 'market.getMcpDetail': {
      return findByIdentifier(mockMcpDetails, input);
    }

    case 'market.getMcpList': {
      return getMcpList(input);
    }

    case 'market.getModelCategories': {
      return [];
    }

    case 'market.getModelDetail': {
      return findByIdentifier(mockModelDetails, input);
    }

    case 'market.getModelIdentifiers': {
      return createIdentifiers(mockModelItems);
    }

    case 'market.getModelList': {
      return getModelList(input);
    }

    case 'market.getProviderDetail': {
      return findByIdentifier(mockProviderDetails, input);
    }

    case 'market.getProviderIdentifiers': {
      return createIdentifiers(mockProviderItems);
    }

    case 'market.getProviderList': {
      return getProviderList(input);
    }

    case 'market.registerClientInMarketplace': {
      return { clientId: 'e2e-market-client', clientSecret: 'e2e-market-secret' };
    }

    case 'market.registerM2MToken': {
      return SUCCESS_RESPONSE;
    }

    case 'market.reportAgentEvent':
    case 'market.reportAgentInstall':
    case 'market.reportCall':
    case 'market.reportGroupAgentEvent':
    case 'market.reportGroupAgentInstall':
    case 'market.reportMcpEvent':
    case 'market.reportMcpInstallResult': {
      return SUCCESS_RESPONSE;
    }

    case 'plugin.getPlugins': {
      return [];
    }

    default: {
      console.log(`   ⚠️ Unhandled mocked lambda endpoint: ${procedure}`);
      return SUCCESS_RESPONSE;
    }
  }
};

const marketHandler: MockHandler = {
  handler: async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const procedures = getProcedures(url);

    if (!procedures.some(isMarketProcedure)) {
      await route.continue();
      return;
    }

    const inputs = getProcedureInputs(request, url, procedures.length);

    // Keep tRPC batch positions intact. Community pages can batch mocked
    // market.* calls with normal app calls, such as plugin.getPlugins on the MCP
    // detail page; returning only market responses would make the batch client
    // read the wrong result for subsequent procedures.
    const responses = procedures.map((procedure, index) =>
      getMockResponse(procedure, inputs[index]),
    );
    const isBatch = url.searchParams.get('batch') === '1' || procedures.length > 1;

    await route.fulfill({
      body: isBatch ? createTrpcBatchResponse(responses) : createTrpcResponse(responses[0]),
      contentType: 'application/json',
      headers: {
        'Set-Cookie': 'mp_token_status=active; Path=/; SameSite=Lax',
      },
      status: 200,
    });
  },
  pattern: '**/trpc/lambda/**',
};

// ============================================
// Export all handlers
// ============================================

export const discoverHandlers: MockHandler[] = [marketHandler];
