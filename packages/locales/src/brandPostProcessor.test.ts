import { BRANDING_NAME, DEFAULT_INBOX_TITLE, LOBE_CHAT_CLOUD } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import {
  applyBrandStrings,
  brandPostProcessor,
  isBrandPostProcessorEnabled,
} from './brandPostProcessor';

// These assertions hold under both default and custom branding: with default
// branding every constant still equals the upstream literal, so each rewrite is
// the identity.
describe('applyBrandStrings', () => {
  it('rewrites the upstream assistant name to the deployment default', () => {
    expect(applyBrandStrings('Ask Lobe AI')).toBe(`Ask ${DEFAULT_INBOX_TITLE}`);
  });

  it('rewrites the upstream product name to the deployment brand', () => {
    expect(applyBrandStrings('Sign in to LobeHub')).toBe(`Sign in to ${BRANDING_NAME}`);
  });

  it('rewrites the pre-rename product name, still present in stale translations', () => {
    expect(applyBrandStrings('LobeChat supports custom API keys')).toBe(
      `${BRANDING_NAME} supports custom API keys`,
    );
  });

  it('prefers the hosted-service name over the bare product name', () => {
    // Longest-first ordering: matching 'LobeHub' first would leave a dangling
    // ' Cloud' and make LOBE_CHAT_CLOUD unreachable from translated copy.
    //
    // A deployment may rename the product but leave the hosted service at the
    // upstream value; the Cloud pair is then an identity and gets dropped, so
    // the shorter rule takes over and produces '<brand> Cloud'. Degraded, but
    // still not a leak — assert that documented fallback rather than failing on
    // a legitimate config.
    const cloudRenamed = (LOBE_CHAT_CLOUD as string) !== 'LobeHub Cloud';
    const brandRenamed = (BRANDING_NAME as string) !== 'LobeHub';
    const expected = !cloudRenamed && brandRenamed ? `${BRANDING_NAME} Cloud` : LOBE_CHAT_CLOUD;

    expect(applyBrandStrings('or just use LobeHub Cloud')).toBe(`or just use ${expected}`);
  });

  it('rewrites every occurrence in one string', () => {
    expect(applyBrandStrings('Lobe AI and Lobe AI')).toBe(
      `${DEFAULT_INBOX_TITLE} and ${DEFAULT_INBOX_TITLE}`,
    );
  });

  it('leaves social handles alone', () => {
    // '@LobeHub' is a Slack account that only exists under the upstream brand;
    // rewriting it would hand the user an address that does not resolve.
    expect(applyBrandStrings('DM @LobeHub on Slack to link your account')).toBe(
      'DM @LobeHub on Slack to link your account',
    );
  });

  it('leaves unrelated copy untouched', () => {
    expect(applyBrandStrings('Start a new topic')).toBe('Start a new topic');
  });

  it('is enabled exactly when the deployment overrode at least one brand name', () => {
    // Cast away the literal types: under a given branding config tsc knows the
    // outcome of these comparisons, but the assertion must hold for both.
    const renamed =
      (BRANDING_NAME as string) !== 'LobeHub' ||
      (LOBE_CHAT_CLOUD as string) !== 'LobeHub Cloud' ||
      (DEFAULT_INBOX_TITLE as string) !== 'Lobe AI';

    expect(isBrandPostProcessorEnabled).toBe(renamed);
  });
});

describe('brandPostProcessor', () => {
  it('passes non-string values through untouched', () => {
    const value = { count: 1 };
    expect(brandPostProcessor.process(value as never, 'key', {}, {} as never)).toBe(value);
  });
});
