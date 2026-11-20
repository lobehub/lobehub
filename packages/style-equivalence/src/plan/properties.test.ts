import { describe, expect, it } from 'vitest';

import { propertiesOverlap } from './properties';

describe('propertiesOverlap', () => {
  it('keeps unrelated properties apart', () => {
    expect(
      propertiesOverlap(
        ['display', 'gap', 'padding-block', 'border-radius', 'font-size', 'line-height'],
        ['color', 'background-color', 'background-image'],
      ),
    ).toBe(false);
  });

  it('finds the same property', () => {
    expect(propertiesOverlap(['color'], ['color'])).toBe(true);
  });

  it('expands shorthands that share a prefix with their longhands', () => {
    expect(propertiesOverlap(['background'], ['background-color'])).toBe(true);
    expect(propertiesOverlap(['border'], ['border-top-style'])).toBe(true);
    expect(propertiesOverlap(['margin'], ['margin-left'])).toBe(true);
  });

  it('expands shorthands whose longhands have other names', () => {
    expect(propertiesOverlap(['border-radius'], ['border-top-left-radius'])).toBe(true);
    expect(propertiesOverlap(['border-width'], ['border-left-width'])).toBe(true);
    expect(propertiesOverlap(['font'], ['line-height'])).toBe(true);
    expect(propertiesOverlap(['inset'], ['top'])).toBe(true);
    expect(propertiesOverlap(['gap'], ['row-gap'])).toBe(true);
    expect(propertiesOverlap(['place-items'], ['justify-items'])).toBe(true);
    expect(propertiesOverlap(['flex-flow'], ['flex-wrap'])).toBe(true);
    expect(propertiesOverlap(['white-space'], ['text-wrap-mode'])).toBe(true);
  });

  it('maps logical properties onto the physical ones they can set', () => {
    expect(propertiesOverlap(['padding-inline'], ['padding-left'])).toBe(true);
    expect(propertiesOverlap(['margin-inline-start'], ['margin-right'])).toBe(true);
    expect(propertiesOverlap(['border-block-end'], ['border-bottom-color'])).toBe(true);
    expect(propertiesOverlap(['inset-inline-start'], ['left'])).toBe(true);
    expect(propertiesOverlap(['inline-size'], ['width'])).toBe(true);
    expect(propertiesOverlap(['max-block-size'], ['max-height'])).toBe(true);
    expect(propertiesOverlap(['border-start-start-radius'], ['border-radius'])).toBe(true);
    expect(propertiesOverlap(['overflow-inline'], ['overflow-x'])).toBe(true);
  });

  it('treats vendor prefixes, aliases and all as the properties they set', () => {
    expect(propertiesOverlap(['-webkit-line-clamp'], ['line-clamp'])).toBe(true);
    expect(propertiesOverlap(['word-wrap'], ['overflow-wrap'])).toBe(true);
    expect(propertiesOverlap(['grid-gap'], ['column-gap'])).toBe(true);
    expect(propertiesOverlap(['all'], ['color'])).toBe(true);
  });
});
