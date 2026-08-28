import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { ModelRefusalError } from './modelRefusal';

describe('ModelRefusalError', () => {
  it('exposes the formal refusal type and diagnostics', () => {
    const diagnostics = {
      finishReason: 'refusal',
      model: 'fable',
      provider: 'lobehub',
    };
    const error = new ModelRefusalError(undefined, diagnostics);

    expect(error).toMatchObject({
      diagnostics,
      errorType: AgentRuntimeErrorType.ModelRefusal,
      message: 'The model declined to answer this request.',
      name: 'ModelRefusalError',
    });
  });
});
