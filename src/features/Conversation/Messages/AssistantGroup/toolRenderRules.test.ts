import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import { describe, expect, it } from 'vitest';

import {
  isImageBearingTool,
  isImageOutputTool,
  resolveToolResultState,
  shouldRenderToolCall,
} from './toolRenderRules';

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

describe('isImageOutputTool', () => {
  it('is false for a tool that merely READ an image', () => {
    expect(
      isImageOutputTool({
        apiName: 'Read',
        id: 't',
        identifier: 'claude-code',
        result: { content: 'x', id: 'r', state: { images: [{ url: 'https://x/a.png' }] } },
      } as any),
    ).toBe(false);
  });

  it('is true for a Codex image output, including upload failures', () => {
    for (const state of [undefined, { images: [{ url: 'https://x/a.png' }] }]) {
      expect(
        isImageOutputTool({
          apiName: 'image_output',
          id: 't',
          identifier: 'codex',
          result: { content: 'x', id: 'r', state },
        } as any),
      ).toBe(true);
    }
  });

  it('is true for a generateImage result only once it carries a finished asset', () => {
    expect(
      isImageOutputTool({
        apiName: 'generateImage',
        id: 't',
        identifier: 'lobe-image-generation',
        result: { content: 'x', id: 'r', state: { generations: [{ asset: { url: 'u' } }] } },
      } as any),
    ).toBe(true);
    expect(
      isImageOutputTool({
        apiName: 'generateImage',
        id: 't',
        identifier: 'lobe-image-generation',
        result: { content: 'x', id: 'r', state: { generations: [{ asset: null }] } },
      } as any),
    ).toBe(false);
  });
});

describe('resolveToolResultState', () => {
  it('reopens interactive results with acknowledged live selections rather than a stale lazy payload', () => {
    const tool = { apiName: 'renderUI', identifier: 'lobe-interactive-ui' };
    const live = { status: 'ready', version: 2, values: { n: 1000, plan: 'C' } };
    const stale = { status: 'ready', version: 2, values: { n: 500, plan: 'B' } };
    expect(resolveToolResultState(tool, live, stale)).toBe(live);
    expect(resolveToolResultState(tool, undefined, stale)).toBe(stale);
  });
  it('keeps lazy full-payload precedence for other projected tools', () => {
    const projected = { summary: true };
    const full = { summary: true, data: [1, 2, 3] };
    expect(
      resolveToolResultState(
        { apiName: 'search', identifier: 'lobe-web-browsing' },
        projected,
        full,
      ),
    ).toBe(full);
  });
});
