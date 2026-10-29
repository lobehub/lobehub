import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { describeHeterogeneousAgent, renderHeteroRuntimeLines } from './heteroAgentDescriptor';

describe('describeHeterogeneousAgent', () => {
  it('describes GitHub Copilot as a local coding CLI with subagents', () => {
    const descriptor = describeHeterogeneousAgent({
      executionTarget: 'local',
      heterogeneousProvider: { type: 'copilot' },
    } as LobeAgentAgencyConfig);

    expect(descriptor).toMatchObject({
      capabilities: expect.arrayContaining(['shell-commands', 'subagents']),
      displayName: 'GitHub Copilot',
      executionTarget: 'local',
      kind: 'cli',
      type: 'copilot',
    });
    expect(renderHeteroRuntimeLines(descriptor)[0]).toContain(
      'Runtime: GitHub Copilot (heterogeneous `copilot` agent',
    );
  });
});
