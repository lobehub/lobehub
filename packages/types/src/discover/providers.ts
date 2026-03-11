import type { LobeDefaultAiModelListItem } from 'model-bank';

import type { ModelProviderCard } from '../llm';

export enum ProviderSorts {
  Default = 'default',
  Identifier = 'identifier',
  ModelCount = 'modelCount',
}

export enum ProviderNavKey {
  Guide = 'guide',
  Overview = 'overview',
  Related = 'related',
}

export interface DiscoverProviderItem extends ModelProviderCard {
  identifier: string;
  modelCount: number;
  models: string[];
}

export interface ProviderQueryParams {
  locale?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: ProviderSorts;
}

export interface ProviderListResponse {
  currentPage: number;
  items: DiscoverProviderItem[];
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface DiscoverProviderDetailModelItem extends LobeDefaultAiModelListItem {
  maxOutput?: number;
}

export interface DiscoverProviderDetail extends Omit<DiscoverProviderItem, 'models'> {
  models: DiscoverProviderDetailModelItem[];
  readme?: string;
  related: DiscoverProviderItem[];
}
