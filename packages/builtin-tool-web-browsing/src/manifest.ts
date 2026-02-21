import type { BuiltinToolManifest } from '@lobechat/types';
import dayjs from 'dayjs';

import { systemPrompt } from './systemRole';
import { WebBrowsingApiName } from './types';

export const WebBrowsingManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'a search service. Useful for when you need to answer questions about current events. Input should be a search query. Output is a JSON array of the query results',
      name: WebBrowsingApiName.search,
      parameters: {
        properties: {
          query: {
            description: 'The search query',
            type: 'string',
          },
          searchCategories: {
            description: 'The search categories you can set:',
            items: {
              enum: ['general', 'images', 'news', 'science', 'videos'],
              type: 'string',
            },
            type: 'array',
          },
          searchEngines: {
            description: 'The search engines you can use:',
            items: {
              enum: [
                'google',
                'bilibili',
                'bing',
                'duckduckgo',
                'npm',
                'pypi',
                'github',
                'arxiv',
                'google scholar',
                'z-library',
                'reddit',
                'imdb',
                'brave',
                'wikipedia',
                'pinterest',
                'unsplash',
                'vimeo',
                'youtube',
              ],
              type: 'string',
            },
            type: 'array',
          },
          searchTimeRange: {
            description: 'The time range you can set:',
            enum: ['anytime', 'day', 'week', 'month', 'year'],
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
    },
    {
      description:
        'A crawler can visit page content. Output is a JSON object of title, content, url and website',
      name: WebBrowsingApiName.crawlSinglePage,
      parameters: {
        properties: {
          url: {
            description: 'The url need to be crawled',
            type: 'string',
          },
        },
        required: ['url'],
        type: 'object',
      },
    },
    {
      description:
        'A crawler can visit multi pages. If need to visit multi website, use this one. Output is an array of JSON object of title, content, url and website',
      name: WebBrowsingApiName.crawlMultiPages,
      parameters: {
        properties: {
          urls: {
            items: {
              description: 'The urls need to be crawled',
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
    readme:
      'Search the web for current information and crawl web pages to extract content. Supports multiple search engines, categories, and time ranges for comprehensive research.',
    title: 'Web Browsing',
  },
  systemRole: systemPrompt(dayjs(new Date()).format('YYYY-MM-DD')),
  type: 'builtin',
};
