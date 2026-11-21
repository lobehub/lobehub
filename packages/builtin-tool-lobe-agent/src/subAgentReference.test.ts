import { describe, expect, it } from 'vitest';

import {
  appendSubAgentReference,
  isCallSubAgentCall,
  LEGACY_CALL_AGENT_NOTE,
  stripSubAgentReference,
  withLegacyCallAgentNote,
} from './subAgentReference';

describe('isCallSubAgentCall', () => {
  it('recognizes callSubAgent and the legacy callAgent alias', () => {
    expect(isCallSubAgentCall({ apiName: 'callSubAgent', identifier: 'lobe-agent' })).toBe(true);
    expect(isCallSubAgentCall({ apiName: 'callAgent', identifier: 'lobe-agent-management' })).toBe(
      true,
    );
  });

  it('rejects other calls', () => {
    expect(isCallSubAgentCall({ apiName: 'cancelSubAgent', identifier: 'lobe-agent' })).toBe(false);
    expect(isCallSubAgentCall({ apiName: 'callAgent', identifier: 'lobe-agent' })).toBe(false);
    expect(
      isCallSubAgentCall({ apiName: 'searchAgent', identifier: 'lobe-agent-management' }),
    ).toBe(false);
    expect(isCallSubAgentCall(undefined)).toBe(false);
  });
});

describe('subAgentReference', () => {
  it('appends the sub-agent id after the result', () => {
    expect(appendSubAgentReference('Findings', 'thd_1')).toBe(
      'Findings\n\n<sub_agent id="thd_1" />',
    );
  });

  it('replaces an existing trailer instead of stacking another one', () => {
    const once = appendSubAgentReference('Findings', 'thd_1');

    expect(appendSubAgentReference(once, 'thd_1')).toBe(once);
  });

  it('keeps an empty result addressable', () => {
    expect(appendSubAgentReference('', 'thd_1')).toBe('<sub_agent id="thd_1" />');
  });

  it('strips only the trailing reference', () => {
    const content = 'See <sub_agent id="thd_0" /> inline\n\n<sub_agent id="thd_1" />';

    expect(stripSubAgentReference(content)).toBe('See <sub_agent id="thd_0" /> inline');
    expect(stripSubAgentReference('Plain result')).toBe('Plain result');
  });

  it('stays linear on long whitespace runs', () => {
    const content = `a${' '.repeat(50_000)}b`;
    const start = performance.now();

    expect(stripSubAgentReference(content)).toBe(content);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe('withLegacyCallAgentNote', () => {
  it('keeps the sub-agent trailer last so it can still be stripped', () => {
    const noted = withLegacyCallAgentNote(appendSubAgentReference('Answer', 'thd_1'));

    expect(noted).toBe(`Answer\n\n${LEGACY_CALL_AGENT_NOTE}\n\n<sub_agent id="thd_1" />`);
    expect(stripSubAgentReference(noted)).toBe(`Answer\n\n${LEGACY_CALL_AGENT_NOTE}`);
  });

  it('notes a result without a trailer', () => {
    expect(withLegacyCallAgentNote('')).toBe(LEGACY_CALL_AGENT_NOTE);
    expect(withLegacyCallAgentNote('Failed')).toBe(`Failed\n\n${LEGACY_CALL_AGENT_NOTE}`);
  });
});
