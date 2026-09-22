import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { describe, expect, it } from 'vitest';

import { shouldShowCustomToolRender } from './shouldShowCustomToolRender';

describe('shouldShowCustomToolRender', () => {
  const subAgent = {
    apiName: LobeAgentApiName.callSubAgent,
    identifier: LobeAgentIdentifier,
    showCustomToolRender: true,
  };

  it('keeps the custom renderer for a failed sub-agent with a preserved thread', () => {
    expect(
      shouldShowCustomToolRender({
        ...subAgent,
        result: { error: { message: 'Child failed' }, state: { threadId: 'thd_saved' } },
      }),
    ).toBe(true);
  });

  it('uses the generic error renderer when there is no child thread to open', () => {
    expect(shouldShowCustomToolRender({ ...subAgent, result: { error: 'Child failed' } })).toBe(
      false,
    );
  });

  it('keeps generic error rendering for other tools', () => {
    expect(
      shouldShowCustomToolRender({
        ...subAgent,
        apiName: LobeAgentApiName.getSubAgentRun,
        result: { error: 'Inspection failed', state: { threadId: 'thd_saved' } },
      }),
    ).toBe(false);
  });

  it('respects the caller setting and ordinary success results', () => {
    expect(shouldShowCustomToolRender({ ...subAgent, result: {} })).toBe(true);
    expect(
      shouldShowCustomToolRender({
        ...subAgent,
        result: { error: 'Child failed', state: { threadId: 'thd_saved' } },
        showCustomToolRender: false,
      }),
    ).toBe(false);
  });
});
