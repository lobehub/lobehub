import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { WebBrowsingApiName } from './types';

export const WebBrowsingManifest: BuiltinToolManifest = {
  api: [
    {
      description: 'Search the web with automatic engine selection.',
      name: WebBrowsingApiName.search,
      parameters: {
        properties: {
          query: {
            description: 'Search query',
            type: 'string',
          },
          searchCategories: {
            description: 'Optional categories',
            items: {
              enum: ['general', 'images', 'news', 'science', 'videos'],
              type: 'string',
            },
            type: 'array',
          },
          searchTimeRange: {
            description: 'Optional time range',
            enum: ['anytime', 'day', 'week', 'month', 'year'],
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
    },
    {
      description: 'Crawl one absolute http(s) HTML/text webpage URL.',
      name: WebBrowsingApiName.crawlSinglePage,
      parameters: {
        properties: {
          url: {
            description: 'Absolute http(s) URL to crawl',
            type: 'string',
          },
        },
        required: ['url'],
        type: 'object',
      },
    },
    {
      description: 'Crawl multiple absolute http(s) HTML/text webpage URLs.',
      name: WebBrowsingApiName.crawlMultiPages,
      parameters: {
        properties: {
          urls: {
            items: {
              description: 'Absolute http(s) URL to crawl',
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['urls'],
        type: 'object',
      },
    },
  ],
  identifier: 'lobe-web-browsing',
  meta: {
    avatar: '🌐',
    description:
      'Search the web for current information and crawl web pages to extract content. Supports automatic engine selection, categories, and time ranges.',
    readme:
      'Search the web for current information and crawl web pages to extract content. Supports automatic engine selection, categories, and time ranges for comprehensive research.',
    title: 'Web Browsing',
  },
  systemRole: systemPrompt(),
  type: 'builtin',
};
