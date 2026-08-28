import { createElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import BrandTextLoading from '@/components/Loading/BrandTextLoading';

import { dynamicElement, dynamicLayout } from './router';

const neverResolves = () => new Promise<{ default: () => null }>(() => {});

const readFallback = (element: ReactElement) =>
  (element as ReactElement<{ fallback: ReactElement }>).props.fallback;

describe('dynamic route helpers', () => {
  it.each([
    ['dynamicLayout', dynamicLayout],
    ['dynamicElement', dynamicElement],
  ])('%s falls back to the brand loading when no fallback is provided', (_, createRouteElement) => {
    expect(readFallback(createRouteElement(neverResolves, 'Test')).type).toBe(BrandTextLoading);
  });

  it.each([
    ['dynamicLayout', dynamicLayout],
    ['dynamicElement', dynamicElement],
  ])('%s suspends on the provided fallback instead', (_, createRouteElement) => {
    const fallback = createElement('div');

    expect(readFallback(createRouteElement(neverResolves, 'Test', { fallback }))).toBe(fallback);
  });
});
