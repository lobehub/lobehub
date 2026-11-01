import { describe, expect, it } from 'vitest';

import { resolveControlBarView, type ResolveControlBarViewParams } from '../resolveControlBarView';

const ready: ResolveControlBarViewParams = {
  agentId: 'agent-1',
  canShowControls: true,
  isAccessLoading: false,
  isAgentConfigLoading: false,
  isPreferenceLoading: false,
};

describe('resolveControlBarView', () => {
  it('keeps a skeleton (not nothing) while the agent-mode preference loads', () => {
    expect(resolveControlBarView({ ...ready, isPreferenceLoading: true })).toBe('skeleton');
  });

  it('keeps a skeleton while resource access resolves', () => {
    expect(resolveControlBarView({ ...ready, canShowControls: false, isAccessLoading: true })).toBe(
      'skeleton',
    );
  });

  it('keeps a skeleton while the agent config or agent id is pending', () => {
    expect(resolveControlBarView({ ...ready, isAgentConfigLoading: true })).toBe('skeleton');
    expect(resolveControlBarView({ ...ready, agentId: '' })).toBe('skeleton');
  });

  it('hides the bar once access resolves to "cannot use"', () => {
    expect(resolveControlBarView({ ...ready, canShowControls: false })).toBe('hidden');
    expect(
      resolveControlBarView({ ...ready, canShowControls: false, isPreferenceLoading: true }),
    ).toBe('hidden');
  });

  it('renders the controls once everything is loaded', () => {
    expect(resolveControlBarView(ready)).toBe('controls');
  });
});
