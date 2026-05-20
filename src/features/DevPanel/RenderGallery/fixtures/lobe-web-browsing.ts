'use client';

import { defineFixtures, single, variants } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-web-browsing',
  fixtures: {
    crawlMultiPages: single({
      args: {
        urls: ['https://lobehub.com', 'https://docs.lobehub.com'],
      },
      pluginState: {
        results: [
          {
            crawler: 'firecrawl',
            data: {
              content: 'LobeHub ships desktop and web experiences for AI collaboration.',
              description: 'Product homepage',
              title: 'LobeHub',
              url: 'https://lobehub.com',
            },
            originalUrl: 'https://lobehub.com',
          },
          {
            crawler: 'firecrawl',
            data: {
              content: 'Developer documentation for routing, tooling, and local testing.',
              description: 'Docs homepage',
              title: 'LobeHub Docs',
              url: 'https://docs.lobehub.com',
            },
            originalUrl: 'https://docs.lobehub.com',
          },
        ],
      },
    }),
    crawlSinglePage: single({
      args: { url: 'https://lobehub.com/blog' },
      pluginState: {
        results: [
          {
            crawler: 'firecrawl',
            data: {
              content: 'Recent product updates and engineering notes.',
              description: 'Blog landing page',
              title: 'LobeHub Blog',
              url: 'https://lobehub.com/blog',
            },
            originalUrl: 'https://lobehub.com/blog',
          },
        ],
      },
    }),
    search: variants([
      {
        args: {
          query: 'LobeHub devtools preview route',
          searchEngines: ['google', 'bing'],
        },
        label: 'With results',
        pluginState: {
          query: 'LobeHub devtools preview route',
          results: [
            {
              content: 'Documentation and implementation notes about local preview tooling.',
              engines: ['google'],
              title: 'Preview tooling guide',
              url: 'https://docs.example.com/preview-tooling',
            },
            {
              content: 'Issue thread describing the /devtools route rollout.',
              engines: ['bing'],
              title: 'Builtin render devtools issue',
              url: 'https://linear.example.com/issue/LOBE-8114',
            },
          ],
        },
      },
      {
        args: {
          query: 'undocumented internal preview snapshot harness',
          searchEngines: ['google'],
        },
        label: 'No results',
        pluginState: {
          query: 'undocumented internal preview snapshot harness',
          results: [],
        },
      },
    ]),
  },
});
