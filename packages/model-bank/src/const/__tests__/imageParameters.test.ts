import { describe, expect, it } from 'vitest';

import { ModelParamsMetaSchema } from '../../standard-parameters';
import { gptImage2Schema } from '../imageParameters';

describe('gptImage2Schema', () => {
  it('exposes the quality tiers the Images API accepts for gpt-image-2', () => {
    expect(gptImage2Schema.quality).toEqual({
      default: 'auto',
      enum: ['auto', 'low', 'medium', 'high'],
    });
  });

  it('omits the tiers gpt-image-2 rejects', () => {
    // The Images API answers 400 "The model 'gpt-image-2' does not support quality 'xhigh'",
    // and the same for 'max'.
    expect(gptImage2Schema.quality?.enum).not.toContain('xhigh');
    expect(gptImage2Schema.quality?.enum).not.toContain('max');
  });

  it('stays valid against the parameter meta-schema', () => {
    expect(() => ModelParamsMetaSchema.parse(gptImage2Schema)).not.toThrow();
  });
});
