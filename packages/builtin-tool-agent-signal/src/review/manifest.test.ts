import { describe, expect, it } from 'vitest';

import { AGENT_SIGNAL_REVIEW_TOOL_API_NAMES } from '../shared/apiNames';
import { agentSignalReviewManifest } from './manifest';

describe('agentSignalReviewManifest', () => {
  it('exposes resource + review tools under its stable identifier', () => {
    expect(agentSignalReviewManifest.identifier).toBe('agent-signal-review');
    expect(agentSignalReviewManifest.type).toBe('builtin');
    // Omitting `executors` defaults to server-only execution.
    expect((agentSignalReviewManifest as { executors?: string[] }).executors).toBeUndefined();
    expect(agentSignalReviewManifest.systemRole).toBeTruthy();

    const names = agentSignalReviewManifest.api.map((a) => a.name);
    expect(names).toEqual([...AGENT_SIGNAL_REVIEW_TOOL_API_NAMES]);
  });

  it('every tool api declares an object parameter schema with a description', () => {
    for (const api of agentSignalReviewManifest.api) {
      expect(api.parameters).toMatchObject({ type: 'object' });
      expect(api.description.length).toBeGreaterThan(0);
    }
  });
});
