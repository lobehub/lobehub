import type * as LobechatConst from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanEditCodexMessage } from './useCanEditCodexMessage';

const state = vi.hoisted(() => ({
  agencyConfig: undefined as LobeAgentAgencyConfig | undefined,
  isPreferenceLoading: false,
  workspaceScoped: false,
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobechatConst>()),
  isDesktop: true,
}));
vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => true }));
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({ useEffectiveAgencyConfig: () => state }));
vi.mock('@/store/agent', () => ({
  useAgentStore: (
    selector: (store: { agentMap: Record<string, { workspaceId?: string }> }) => unknown,
  ) => selector({ agentMap: {} }),
}));

/** @example A Codex topic uses the same valid runtime selection for Send and Edit. */
describe('useCanEditCodexMessage', () => {
  beforeEach(() => {
    state.agencyConfig = { heterogeneousProvider: { type: 'codex' } };
    state.isPreferenceLoading = false;
    state.workspaceScoped = false;
  });

  /** @example A connected device topic can edit through server dispatch. */
  it('offers Edit for Codex running on a bound device', () => {
    state.agencyConfig = {
      boundDeviceId: 't647-device',
      executionTarget: 'device',
      heterogeneousProvider: { type: 'codex' },
    };
    // ROOT CAUSE:
    //
    // The previous hook only accepted the local `hetero` runtime. Device sends
    // resolve to `gateway`, so their valid edit path was never reachable.
    // The fix retains runtime authorization and admits the bound device target.
    /** @example Device dispatch exposes the edit action. */
    expect(useCanEditCodexMessage('agent', 'topic')).toBe(true);
  });

  /** @example Existing desktop-local Codex editing remains available. */
  it('retains local Codex editing', () => {
    /** @example An ordinary desktop Codex configuration stays editable. */
    expect(useCanEditCodexMessage('agent', 'topic')).toBe(true);
  });

  /** @example An unresolved device choice cannot create an executable edit. */
  it('does not offer a device edit without a device binding', () => {
    state.agencyConfig = { executionTarget: 'device', heterogeneousProvider: { type: 'codex' } };
    /** @example An unbound device target stays unavailable. */
    expect(useCanEditCodexMessage('agent', 'topic')).toBe(false);
  });

  /** @example Device support does not bypass an API binding restricted to local execution. */
  it('preserves the existing API-binding runtime guard', () => {
    state.agencyConfig = {
      boundDeviceId: 't647-device',
      executionTarget: 'device',
      heterogeneousProvider: { authMode: 'api', type: 'codex' },
    };
    /** @example A rejected runtime configuration never exposes Edit. */
    expect(useCanEditCodexMessage('agent', 'topic')).toBe(false);
  });

  /** @example Shared preference loading must settle before an action becomes available. */
  it('waits for effective preferences', () => {
    state.isPreferenceLoading = true;
    /** @example Loading cannot accidentally enable the action. */
    expect(useCanEditCodexMessage('agent', 'topic')).toBe(false);
  });

  /** @example Other CLI providers keep their existing action slots. */
  it('does not enable Claude Code editing', () => {
    state.agencyConfig = { heterogeneousProvider: { type: 'claude-code' } };
    /** @example This task changes only Codex user messages. */
    expect(useCanEditCodexMessage('agent', 'topic')).toBe(false);
  });
});
