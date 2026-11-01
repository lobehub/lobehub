import { type CategoryListQuery } from '@lobehub/market-sdk';

import type { DiscoverService } from './index';
import { log } from './utils';

// ============================== Group Agent Market Methods ==============================

export const getGroupAgentCategories = async (
  service: DiscoverService,
  params?: CategoryListQuery,
) => {
  try {
    // TODO: SDK method not yet available, using fallback
    const response = await (service.market.agentGroups as any).getAgentGroupCategories?.(params);
    return response || { items: [] };
  } catch (error) {
    log('getGroupAgentCategories: error: %O', error);
    return { items: [] };
  }
};

export const getGroupAgentDetail = async (
  service: DiscoverService,
  params: {
    identifier: string;
    locale?: string;
    version?: string;
  },
) => {
  try {
    const response = await service.market.agentGroups.getAgentGroupDetail(params.identifier, {
      locale: params.locale,
      version: params.version ? Number(params.version) : undefined,
    });
    return response;
  } catch (error) {
    log('getGroupAgentDetail: error: %O', error);
    throw error;
  }
};

export const getGroupAgentIdentifiers = async (service: DiscoverService) => {
  try {
    // TODO: SDK method not yet available, using fallback
    const response = await (service.market.agentGroups as any).getAgentGroupIdentifiers?.();
    return response || { identifiers: [] };
  } catch (error) {
    log('getGroupAgentIdentifiers: error: %O', error);
    return { identifiers: [] };
  }
};

export const getGroupAgentList = async (
  service: DiscoverService,
  params?: {
    category?: string;
    locale?: string;
    order?: 'asc' | 'desc';
    ownerId?: string;
    page?: number;
    pageSize?: number;
    q?: string;
    sort?: 'createdAt' | 'updatedAt' | 'name' | 'recommended';
  },
) => {
  try {
    const response = await service.market.agentGroups.getAgentGroupList({
      ...params,
      status: 'published' as any,
      visibility: 'public' as any,
    });
    return response;
  } catch (error) {
    log('getGroupAgentList: error: %O', error);
    return { currentPage: 1, items: [], totalCount: 0, totalPages: 1 };
  }
};

export const createGroupAgentEvent = async (
  service: DiscoverService,
  params: {
    event: 'add' | 'chat' | 'click';
    identifier: string;
    source?: string;
  },
) => {
  try {
    // TODO: SDK method not yet available
    await (service.market.agentGroups as any).createAgentGroupEvent?.(params);
  } catch (error) {
    log('createGroupAgentEvent: error: %O', error);
  }
};

export const increaseGroupAgentInstallCount = async (
  service: DiscoverService,
  identifier: string,
) => {
  try {
    // TODO: SDK method not yet available
    await (service.market.agentGroups as any).increaseInstallCount?.(identifier);
  } catch (error) {
    log('increaseGroupAgentInstallCount: error: %O', error);
  }
};
