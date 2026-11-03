import type { LobeDefaultAiModelListItem } from 'model-bank';

import type { ModelProviderCard } from '../llm';

export enum ModelSorts {
  ContextWindowTokens = 'contextWindowTokens',
  Identifier = 'identifier',
  InputPrice = 'inputPrice',
  OutputPrice = 'outputPrice',
  ProviderCount = 'providerCount',
  ReleasedAt = 'releasedAt',
}

export enum ModelNavKey {
  Overview = 'overview',
  Parameter = 'parameter',
  Related = 'related',
}

export interface DiscoverModelItem extends LobeDefaultAiModelListItem {
  category?: string;
  identifier: string;
  providerCount: number;
  providers: string[];
}

export interface ModelQueryParams {
  category?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: ModelSorts;
}

export interface ModelListResponse {
  currentPage: number;
  items: DiscoverModelItem[];
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface DiscoverModelDetailProviderItem extends ModelProviderCard {
  model?: LobeDefaultAiModelListItem;
}

export interface DiscoverModelDetail extends Omit<DiscoverModelItem, 'providers'> {
  maxOutput?: number;
  providers: DiscoverModelDetailProviderItem[];
  related: DiscoverModelItem[];
}
