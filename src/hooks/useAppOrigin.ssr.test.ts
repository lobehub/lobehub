// @vitest-environment node

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AppOriginContext } from './appOriginContext';
import { useAppOrigin } from './useAppOrigin';

// Use the actual Workbench server adapter: it deliberately has no desktop config.
vi.mock('@/store/electron', () => import('../../apps/workbench/app/stubs/electronStore'));

const ShareLink = () =>
  createElement('a', { href: `${useAppOrigin()}/acceptance/report` }, 'Report');

describe('useAppOrigin during SSR', () => {
  it('renders a report link without browser globals or desktop state', () => {
    expect(renderToStaticMarkup(createElement(ShareLink))).toBe(
      '<a href="/acceptance/report">Report</a>',
    );
  });

  it('uses the SSR host origin for report links without sharing it across requests', () => {
    const render = (origin: string) =>
      renderToStaticMarkup(
        createElement(AppOriginContext, { value: origin }, createElement(ShareLink)),
      );

    expect(render('https://lobehub.com')).toBe(
      '<a href="https://lobehub.com/acceptance/report">Report</a>',
    );
    expect(render('https://self-hosted.example')).toBe(
      '<a href="https://self-hosted.example/acceptance/report">Report</a>',
    );
    expect(renderToStaticMarkup(createElement(ShareLink))).toBe(
      '<a href="/acceptance/report">Report</a>',
    );
  });
});
