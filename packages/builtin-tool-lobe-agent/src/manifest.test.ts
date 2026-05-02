import { describe, expect, it } from 'vitest';

import { LobeAgentManifest } from './manifest';

describe('LobeAgentManifest', () => {
  it('should instruct the model to answer after visual analysis returns', () => {
    expect(LobeAgentManifest.systemRole).toContain(
      'After analyzeVisualMedia returns, use its result to answer the user directly.',
    );
    expect(LobeAgentManifest.systemRole).toContain(
      'Do not treat the tool call itself as the final response.',
    );
  });
});
