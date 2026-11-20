import { describe, expect, it } from 'vitest';

import { resolveFalEndpointId, resolveFalImageEndpoint } from './endpoint';

describe('resolveFalEndpointId', () => {
  it.each([
    // Endpoints outside the `fal-ai/` namespace are used verbatim
    ['bytedance/seedance-2.5', 'bytedance/seedance-2.5'],
    ['black-forest-labs/flux-2-pro', 'black-forest-labs/flux-2-pro'],
    ['openai/gpt-image-1/text-to-image', 'openai/gpt-image-1/text-to-image'],
    ['someone/my-app/variant', 'someone/my-app/variant'],
    // fal serves newer Seedream releases under the top-level bytedance owner
    ['bytedance/seedream/v5/flash/edit', 'bytedance/seedream/v5/flash/edit'],
    ['fal-ai/flux/dev', 'fal-ai/flux/dev'],
    // Bare and legacy short ids keep resolving to fal-ai
    ['nano-banana', 'fal-ai/nano-banana'],
    ['flux/dev', 'fal-ai/flux/dev'],
    ['bytedance/seedream/v4', 'fal-ai/bytedance/seedream/v4'],
    [' /fal-ai/flux/dev/ ', 'fal-ai/flux/dev'],
  ])('resolves %s to %s', (model, endpoint) => {
    expect(resolveFalEndpointId(model)).toBe(endpoint);
  });
});

describe('resolveFalImageEndpoint', () => {
  it('adds the task path to one-card families', () => {
    expect(resolveFalImageEndpoint('fal-ai/bytedance/seedream/v4.5', false)).toBe(
      'fal-ai/bytedance/seedream/v4.5/text-to-image',
    );
    expect(resolveFalImageEndpoint('fal-ai/bytedance/seedream/v4.5', true)).toBe(
      'fal-ai/bytedance/seedream/v4.5/edit',
    );
  });

  it('does not add a second task path to an endpoint that already names one', () => {
    expect(resolveFalImageEndpoint('fal-ai/bytedance/seedream/v4.5/edit', true)).toBe(
      'fal-ai/bytedance/seedream/v4.5/edit',
    );
    expect(resolveFalImageEndpoint('fal-ai/hunyuan-image/v3/text-to-image', false)).toBe(
      'fal-ai/hunyuan-image/v3/text-to-image',
    );
  });
});
