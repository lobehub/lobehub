import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import { describe, expect, it } from 'vitest';

import { isImageBearingTool, shouldRenderToolCall } from './toolRenderRules';

describe('shouldRenderToolCall', () => {
  it('hides the onboarding completion tool call', () => {
    expect(
      shouldRenderToolCall({
        apiName: WebOnboardingApiName.finishOnboarding,
        identifier: WebOnboardingIdentifier,
      }),
    ).toBe(false);
  });

  it('keeps other onboarding tool calls visible', () => {
    expect(
      shouldRenderToolCall({
        apiName: WebOnboardingApiName.saveUserQuestion,
        identifier: WebOnboardingIdentifier,
      }),
    ).toBe(true);
  });

  it('keeps non-onboarding tool calls visible', () => {
    expect(
      shouldRenderToolCall({
        apiName: 'search',
        identifier: 'lobe-web-browsing',
      }),
    ).toBe(true);
  });
});

describe('isImageBearingTool', () => {
  const cc = (state?: unknown) =>
    ({
      apiName: 'Read',
      id: 't',
      identifier: 'claude-code',
      result: { content: 'x', id: 'r', state },
    }) as any;

  it('is true once a tool result carries an uploaded image', () => {
    expect(isImageBearingTool(cc({ images: [{ url: 'https://x/a.png' }] }))).toBe(true);
  });

  it('is false while the result is missing or the upload failed', () => {
    expect(isImageBearingTool(cc())).toBe(false);
    expect(isImageBearingTool(cc({ images: [{}] }))).toBe(false);
  });

  it('is true for a generateImage result with a finished asset', () => {
    expect(
      isImageBearingTool({
        apiName: 'generateImage',
        id: 't',
        identifier: 'lobe-image-generation',
        result: { content: 'x', id: 'r', state: { generations: [{ asset: { url: 'u' } }] } },
      } as any),
    ).toBe(true);
    expect(
      isImageBearingTool({
        apiName: 'generateImage',
        id: 't',
        identifier: 'lobe-image-generation',
        result: { content: 'x', id: 'r', state: { generations: [{ asset: null }] } },
      } as any),
    ).toBe(false);
  });
});
