// @vitest-environment node

import { createElement, lazy, Suspense } from 'react';
import type { EntryContext } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import handleRequest from './entry.server';

vi.mock('virtual:lobehub/antd-static-css', () => ({ styleKeys: [] }));

vi.mock('react-router', () => ({
  ServerRouter: () => {
    const Report = lazy(async () => ({
      default: () =>
        createElement(
          'main',
          null,
          Array.from({ length: 1200 }, (_, index) =>
            createElement('p', { key: index }, `Report evidence item ${index}`),
          ),
        ),
    }));

    return createElement(
      'html',
      null,
      createElement('head'),
      createElement(
        'body',
        null,
        createElement(
          Suspense,
          { fallback: createElement('span', { 'aria-label': 'Loading' }) },
          createElement(Report),
        ),
      ),
    );
  },
}));

describe('workbench SSR document', () => {
  it('renders a completed large report inline without waiting for a browser reveal script', async () => {
    const response = await handleRequest(
      new Request('https://workbench.example/acceptance/report'),
      200,
      new Headers(),
      {} as EntryContext,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<p>Report evidence item 1199</p>');
    expect(html.includes('aria-label="Loading"')).toBe(false);
    expect(html.includes('<div hidden')).toBe(false);
  });
});
