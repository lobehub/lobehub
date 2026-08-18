import { AICO_PRODUCT_VERSION } from '@lobechat/const';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveVersion } from './route';

describe('resolveVersion', () => {
  afterEach(() => {
    delete process.env.PANACHAT_VERSION;
  });

  it('falls back to Aico product version when PANACHAT_VERSION is unset', () => {
    delete process.env.PANACHAT_VERSION;
    expect(resolveVersion()).toBe(AICO_PRODUCT_VERSION);
    expect(resolveVersion()).toBe('0.9.1');
  });

  it('prefers a non-empty PANACHAT_VERSION override', () => {
    process.env.PANACHAT_VERSION = '1.2.3';
    expect(resolveVersion()).toBe('1.2.3');
  });

  it('treats whitespace-only PANACHAT_VERSION as unset', () => {
    process.env.PANACHAT_VERSION = '  ';
    expect(resolveVersion()).toBe('0.9.1');
  });
});
