import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import { describe, expect, it } from 'vitest';

import {
  getBreakoutPredicate,
  isBreakoutTool,
  isDeliverableTool,
  isImageBearingTool,
  isImageOutputTool,
  isImageReadTool,
  isMcpAppTool,
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

describe('isMcpAppTool', () => {
  const mcp = (state?: unknown) =>
    ({
      apiName: 'get_weather',
      id: 't',
      identifier: 'weather-demo',
      result: { content: 'x', id: 'r', state },
    }) as any;
  const view = { mcpApp: { resourceUri: 'ui://weather/view' }, content: [] };

  it('is true once the result carries an MCP App view, on client and server-runtime shapes', () => {
    expect(isMcpAppTool(mcp(view))).toBe(true);
    expect(isMcpAppTool(mcp({ content: 'x', state: view, success: true }))).toBe(true);
  });

  it('is false while the result is missing or declares no ui:// view', () => {
    expect(isMcpAppTool(mcp())).toBe(false);
    expect(isMcpAppTool(mcp({ content: [] }))).toBe(false);
    expect(isMcpAppTool(mcp({ content: [], mcpApp: { resourceUri: 'https://x' } }))).toBe(false);
  });

  it('breaks out of collapsed workflow runs', () => {
    expect(isBreakoutTool(mcp(view))).toBe(true);
    expect(isBreakoutTool(mcp({ content: [] }))).toBe(false);
  });
});

describe('getBreakoutPredicate', () => {
  const imageRead = {
    apiName: 'Read',
    id: 't',
    identifier: 'claude-code',
    result: { content: 'x', id: 'r', state: { images: [{ url: 'https://x/a.png' }] } },
  } as any;
  const mcpApp = {
    apiName: 'get_weather',
    id: 't',
    identifier: 'weather-demo',
    result: { content: 'x', id: 'r', state: { mcpApp: { resourceUri: 'ui://weather/view' } } },
  } as any;

  it('breaks out image reads unless the user turned them off', () => {
    expect(isImageReadTool(imageRead)).toBe(true);
    expect(getBreakoutPredicate({})(imageRead)).toBe(true);
    expect(getBreakoutPredicate({ showImageReads: false })(imageRead)).toBe(false);
  });

  it('breaks out MCP App views only behind the runtime flag', () => {
    expect(getBreakoutPredicate({ showImageReads: false })(mcpApp)).toBe(false);
    expect(getBreakoutPredicate({ enableMcpApps: true, showImageReads: false })(mcpApp)).toBe(true);
  });
});

describe('Codex proposed plan', () => {
  const plan = { apiName: 'proposed_plan', id: 'plan-1', identifier: 'codex' } as any;

  it('is the turn deliverable, so a finished turn keeps it out of the fold', () => {
    expect(isDeliverableTool(plan)).toBe(true);
    expect(isDeliverableTool({ ...plan, apiName: 'command_execution' })).toBe(false);
  });

  it('breaks out of a collapsed run whatever the image setting', () => {
    expect(isBreakoutTool(plan)).toBe(true);
    expect(getBreakoutPredicate({ showImageReads: false })(plan)).toBe(true);
    expect(getBreakoutPredicate({ enableMcpApps: true })(plan)).toBe(true);
    expect(getBreakoutPredicate({})({ ...plan, identifier: 'claude-code' })).toBe(false);
  });
});
